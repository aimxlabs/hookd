import { Hono } from "hono";
import { eq, desc, and, isNull, gt, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { timingSafeEqual } from "node:crypto";
import { getDb, schema } from "../../db/index.js";
import {
  CHANNEL_ID_PREFIX,
  TOKEN_PREFIX,
  MAX_QUERY_LIMIT,
} from "../../shared/constants.js";
import type { Provider } from "../../shared/types.js";
import { verifyHelloMessage, extractHelloToken } from "../hello.js";

const VALID_PROVIDERS = new Set(["github", "stripe", "slack", "generic"]);

const api = new Hono();

// ── Helpers ──────────────────────────────────────────────────────

/** Constant-time string comparison for auth tokens. */
function tokenEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Extract Bearer token from Authorization header. */
function extractToken(c: { req: any }): string | undefined {
  return c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
}

/** Clamp a limit query parameter to [1, MAX_QUERY_LIMIT]. */
function clampLimit(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? String(fallback), 10);
  if (isNaN(n) || n < 1) return fallback;
  return Math.min(n, MAX_QUERY_LIMIT);
}

/**
 * Validate a callback URL to prevent SSRF.
 * Rejects private/reserved IPs, metadata endpoints, and non-HTTP(S) schemes.
 */
function isValidCallbackUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  // Only allow http(s)
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase();

  // Block cloud metadata endpoints
  const blockedHostnames = new Set([
    "169.254.169.254", // AWS/Azure/GCP instance metadata
    "metadata.google.internal", // GCP metadata
    "metadata.azure.com", // Azure metadata
  ]);
  if (blockedHostnames.has(hostname)) return false;

  // Block localhost / loopback
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost")
  ) {
    return false;
  }

  // Block private/reserved IPv4 ranges
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 0) return false; // 0.0.0.0/8 "this" network
    if (a === 10) return false; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 CGN
    if (a === 127) return false; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return false; // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
    if (a === 192 && b === 168) return false; // 192.168.0.0/16
  }

  // Block IPv6 private ranges (bracket-wrapped in URLs)
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (
    bare.startsWith("fc") ||
    bare.startsWith("fd") || // ULA
    bare.startsWith("fe80") || // link-local
    bare === "::1" // loopback
  ) {
    return false;
  }

  return true;
}

/**
 * Require admin token for management endpoints.
 * Admin token is set via HOOKD_ADMIN_TOKEN env var.
 * If no admin token is configured, management endpoints are unrestricted
 * (assumes localhost-only access).
 */
function requireAdmin(c: { req: any }): Response | null {
  const adminToken = process.env.HOOKD_ADMIN_TOKEN;
  if (!adminToken) return null; // No admin token configured — allow (local dev)

  const provided = extractToken(c);
  if (!provided || !tokenEquals(provided, adminToken)) {
    return c.json({ error: "Unauthorized — admin token required" }, 401) as any;
  }
  return null;
}

/**
 * Authorize access to a channel via either:
 * 1. Hello-message auth (if channel has ownerAddress) — verifies signer matches owner
 * 2. Bearer token auth (legacy) — timing-safe token comparison
 *
 * Returns the verified Ethereum address on hello-message success, or true on token success.
 * Returns an error Response if auth fails.
 */
function authorizeChannel(
  c: any,
  channel: { authToken: string; ownerAddress: string | null },
): Response | string | true {
  // Try hello-message auth first
  const authHeader = c.req.header("authorization") as string | undefined;
  const helloToken = extractHelloToken(authHeader);
  if (helloToken) {
    const result = verifyHelloMessage(helloToken);
    if (!result.valid) {
      return c.json(
        { error: "hello-message verification failed: " + (result.error ?? "unknown") },
        401,
      );
    }
    if (
      channel.ownerAddress &&
      result.address.toLowerCase() !== channel.ownerAddress.toLowerCase()
    ) {
      return c.json({ error: "hello-message signer is not the channel owner" }, 403);
    }
    if (!channel.ownerAddress) {
      return c.json(
        { error: "channel does not support hello-message auth — use Bearer token" },
        401,
      );
    }
    return result.address;
  }

  // Fall back to bearer token auth
  if (channel.ownerAddress) {
    return c.json(
      { error: "this channel requires hello-message auth (Authorization: Hello <base64>)" },
      401,
    );
  }
  const token = extractToken(c);
  if (!token || !tokenEquals(token, channel.authToken)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return true;
}

// ── Channel CRUD (admin or hello-message) ────────────────────────

// Create a channel
api.post("/api/channels", async (c) => {
  // Check for hello-message auth — allows agents to create their own channels
  const authHeader = c.req.header("authorization") as string | undefined;
  const helloToken = extractHelloToken(authHeader);
  let ownerAddress: string | null = null;

  if (helloToken) {
    const result = verifyHelloMessage(helloToken);
    if (!result.valid) {
      return c.json(
        { error: "hello-message verification failed: " + (result.error ?? "unknown") },
        401,
      );
    }
    ownerAddress = result.address.toLowerCase();
  } else {
    // Fall back to admin token auth
    const denied = requireAdmin(c);
    if (denied) return denied;
  }

  const body = await c.req.json<{
    name: string;
    provider?: Provider;
    secret?: string;
    callbackUrl?: string;
  }>();

  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: "name is required" }, 400);
  }

  if (body.name.length > 256) {
    return c.json({ error: "name must be 256 characters or fewer" }, 400);
  }

  if (body.provider && !VALID_PROVIDERS.has(body.provider)) {
    return c.json(
      {
        error: `Invalid provider — must be one of: ${[...VALID_PROVIDERS].join(", ")}`,
      },
      400,
    );
  }

  if (body.callbackUrl && !isValidCallbackUrl(body.callbackUrl)) {
    return c.json(
      { error: "Invalid callbackUrl — must be a public HTTP(S) URL" },
      400,
    );
  }

  const db = getDb();
  const id = `${CHANNEL_ID_PREFIX}${nanoid(16)}`;
  const authToken = `${TOKEN_PREFIX}${nanoid(24)}`;
  const now = Math.floor(Date.now() / 1000);

  db.insert(schema.channels)
    .values({
      id,
      name: body.name,
      provider: body.provider ?? null,
      secret: body.secret ?? null,
      callbackUrl: body.callbackUrl ?? null,
      authToken,
      ownerAddress,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const response: Record<string, any> = {
    id,
    name: body.name,
    provider: body.provider ?? null,
    callbackUrl: body.callbackUrl ?? null,
    createdAt: now,
    updatedAt: now,
  };

  // Only return authToken for admin-created channels (not hello-message channels)
  if (!ownerAddress) {
    response.authToken = authToken;
  } else {
    response.ownerAddress = ownerAddress;
  }

  return c.json(response, 201);
});

// List channels (admin-protected)
api.get("/api/channels", (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const db = getDb();
  const allChannels = db
    .select({
      id: schema.channels.id,
      name: schema.channels.name,
      provider: schema.channels.provider,
      callbackUrl: schema.channels.callbackUrl,
      createdAt: schema.channels.createdAt,
    })
    .from(schema.channels)
    .orderBy(desc(schema.channels.createdAt))
    .all();

  return c.json(allChannels);
});

// Get a channel (admin-protected)
api.get("/api/channels/:id", (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const db = getDb();
  const [channel] = db
    .select({
      id: schema.channels.id,
      name: schema.channels.name,
      provider: schema.channels.provider,
      callbackUrl: schema.channels.callbackUrl,
      createdAt: schema.channels.createdAt,
      updatedAt: schema.channels.updatedAt,
    })
    .from(schema.channels)
    .where(eq(schema.channels.id, c.req.param("id")))
    .all();

  if (!channel) return c.json({ error: "Channel not found" }, 404);
  return c.json(channel);
});

// Delete a channel (admin-protected)
api.delete("/api/channels/:id", (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const db = getDb();
  const [channel] = db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(eq(schema.channels.id, c.req.param("id")))
    .all();

  if (!channel) return c.json({ error: "Channel not found" }, 404);

  db.delete(schema.channels)
    .where(eq(schema.channels.id, c.req.param("id")))
    .run();

  return c.json({ deleted: true });
});

// ── Event access (channel-token-protected) ──────────────────────

// Get recent events for a channel (requires channel token or hello-message)
api.get("/api/channels/:id/events", (c) => {
  const db = getDb();
  const channelId = c.req.param("id");
  const limit = clampLimit(c.req.query("limit"), 20);

  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .all();

  if (!channel) return c.json({ error: "Channel not found" }, 404);
  const authResult = authorizeChannel(c, channel);
  if (authResult instanceof Response) return authResult;

  const channelEvents = db
    .select()
    .from(schema.events)
    .where(eq(schema.events.channelId, channelId))
    .orderBy(desc(schema.events.receivedAt))
    .limit(limit)
    .all();

  return c.json(channelEvents);
});

// Poll for undelivered events (cron-friendly)
api.get("/api/channels/:id/poll", (c) => {
  const db = getDb();
  const channelId = c.req.param("id");
  const limit = clampLimit(c.req.query("limit"), 100);
  const afterCursor = c.req.query("after"); // event ID cursor

  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .all();

  if (!channel) return c.json({ error: "Channel not found" }, 404);
  const authResult = authorizeChannel(c, channel);
  if (authResult instanceof Response) return authResult;

  // Build query: undelivered events for this channel
  let conditions = and(
    eq(schema.events.channelId, channelId),
    isNull(schema.events.deliveredAt),
  );

  // If cursor provided, only return events received after that event
  if (afterCursor) {
    const [cursorEvent] = db
      .select({ receivedAt: schema.events.receivedAt })
      .from(schema.events)
      .where(eq(schema.events.id, afterCursor))
      .all();

    if (cursorEvent) {
      conditions = and(
        conditions,
        gt(schema.events.receivedAt, cursorEvent.receivedAt),
      );
    }
  }

  const pendingEvents = db
    .select()
    .from(schema.events)
    .where(conditions!)
    .orderBy(schema.events.receivedAt)
    .limit(limit)
    .all();

  // Parse stored JSON headers back to objects
  const events = pendingEvents.map((evt) => ({
    ...evt,
    headers: JSON.parse(evt.headers) as Record<string, string>,
  }));

  return c.json({
    events,
    cursor: events.length > 0 ? events[events.length - 1].id : null,
  });
});

// Acknowledge (mark as delivered) polled events
api.post("/api/channels/:id/ack", async (c) => {
  const db = getDb();
  const channelId = c.req.param("id");

  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .all();

  if (!channel) return c.json({ error: "Channel not found" }, 404);
  const authResult = authorizeChannel(c, channel);
  if (authResult instanceof Response) return authResult;

  const body = await c.req.json<{ eventIds: string[] }>();

  if (!Array.isArray(body.eventIds) || body.eventIds.length === 0) {
    return c.json({ error: "eventIds array is required" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  const result = db
    .update(schema.events)
    .set({ deliveredAt: now })
    .where(
      and(
        eq(schema.events.channelId, channelId),
        inArray(schema.events.id, body.eventIds),
      ),
    )
    .run();

  return c.json({ acknowledged: result.changes });
});

export default api;
export { isValidCallbackUrl, tokenEquals };
