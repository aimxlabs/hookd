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

const api = new Hono();

// ── Helpers ──────────────────────────────────────────────────────

/** Constant-time string comparison for auth tokens. */
function tokenEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Extract Bearer token from Authorization header or query param. */
function extractToken(c: { req: any }): string | undefined {
  return (
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ??
    c.req.query("token")
  );
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
  if (hostname === "169.254.169.254" || hostname === "metadata.google.internal") {
    return false;
  }

  // Block localhost / loopback
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0"
  ) {
    return false;
  }

  // Block private IPv4 ranges
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10) return false;                          // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return false;   // 172.16.0.0/12
    if (a === 192 && b === 168) return false;             // 192.168.0.0/16
    if (a === 169 && b === 254) return false;             // 169.254.0.0/16 link-local
  }

  return true;
}

/**
 * Require admin token for management endpoints.
 * Admin token is set via HOOKR_ADMIN_TOKEN env var.
 * If no admin token is configured, management endpoints are unrestricted
 * (assumes localhost-only access).
 */
function requireAdmin(c: { req: any }): Response | null {
  const adminToken = process.env.HOOKR_ADMIN_TOKEN;
  if (!adminToken) return null; // No admin token configured — allow (local dev)

  const provided = extractToken(c);
  if (!provided || !tokenEquals(provided, adminToken)) {
    return c.json({ error: "Unauthorized — admin token required" }, 401) as any;
  }
  return null;
}

// ── Channel CRUD (admin-protected) ──────────────────────────────

// Create a channel
api.post("/api/channels", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

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
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, id))
    .all();

  return c.json(channel, 201);
});

// List channels (public — no secrets returned)
api.get("/api/channels", (c) => {
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

// Get a channel (public — no secrets returned)
api.get("/api/channels/:id", (c) => {
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

// Get recent events for a channel (requires channel token)
api.get("/api/channels/:id/events", (c) => {
  const db = getDb();
  const channelId = c.req.param("id");
  const limit = clampLimit(c.req.query("limit"), 20);

  const token = extractToken(c);

  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .all();

  if (!channel) return c.json({ error: "Channel not found" }, 404);
  if (!token || !tokenEquals(token, channel.authToken)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

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

  const token = extractToken(c);

  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .all();

  if (!channel) return c.json({ error: "Channel not found" }, 404);
  if (!token || !tokenEquals(token, channel.authToken)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

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

  const token = extractToken(c);

  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .all();

  if (!channel) return c.json({ error: "Channel not found" }, 404);
  if (!token || !tokenEquals(token, channel.authToken)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

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
