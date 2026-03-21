import { Hono } from "hono";
import { eq, desc, and, isNull, gt, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../db/index.js";
import {
  CHANNEL_ID_PREFIX,
  TOKEN_PREFIX,
} from "../../shared/constants.js";
import type { Provider } from "../../shared/types.js";

const api = new Hono();

// Create a channel
api.post("/api/channels", async (c) => {
  const body = await c.req.json<{
    name: string;
    provider?: Provider;
    secret?: string;
    callbackUrl?: string;
  }>();

  if (!body.name) {
    return c.json({ error: "name is required" }, 400);
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

// List channels
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

// Get a channel
api.get("/api/channels/:id", (c) => {
  const db = getDb();
  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, c.req.param("id")))
    .all();

  if (!channel) return c.json({ error: "Channel not found" }, 404);
  return c.json(channel);
});

// Delete a channel
api.delete("/api/channels/:id", (c) => {
  const db = getDb();
  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, c.req.param("id")))
    .all();

  if (!channel) return c.json({ error: "Channel not found" }, 404);

  db.delete(schema.channels)
    .where(eq(schema.channels.id, c.req.param("id")))
    .run();

  return c.json({ deleted: true });
});

// Get recent events for a channel
api.get("/api/channels/:id/events", (c) => {
  const db = getDb();
  const limit = parseInt(c.req.query("limit") ?? "20", 10);

  const channelEvents = db
    .select()
    .from(schema.events)
    .where(eq(schema.events.channelId, c.req.param("id")))
    .orderBy(desc(schema.events.receivedAt))
    .limit(limit)
    .all();

  return c.json(channelEvents);
});

// Poll for undelivered events (cron-friendly)
api.get("/api/channels/:id/poll", (c) => {
  const db = getDb();
  const channelId = c.req.param("id");
  const limit = parseInt(c.req.query("limit") ?? "100", 10);
  const afterCursor = c.req.query("after"); // event ID cursor

  // Auth: require the channel's token
  const token =
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ??
    c.req.query("token");

  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .all();

  if (!channel) return c.json({ error: "Channel not found" }, 404);
  if (!token || token !== channel.authToken) {
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

  // Auth: require the channel's token
  const token =
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ??
    c.req.query("token");

  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .all();

  if (!channel) return c.json({ error: "Channel not found" }, 404);
  if (!token || token !== channel.authToken) {
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
