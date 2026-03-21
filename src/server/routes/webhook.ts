import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../db/index.js";
import { verifyWebhookSignature } from "../verify.js";
import { deliverEvent } from "../delivery.js";
import { EVENT_ID_PREFIX } from "../../shared/constants.js";

const webhook = new Hono();

webhook.post("/h/:channelId", async (c) => {
  const channelId = c.req.param("channelId");
  const db = getDb();

  // Look up channel
  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .all();

  if (!channel) {
    return c.json({ error: "Channel not found" }, 404);
  }

  // Read raw body
  const body = await c.req.text();

  // Get headers as plain object (lowercased keys)
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // Verify signature if provider + secret are set
  if (channel.provider && channel.secret) {
    const valid = verifyWebhookSignature(
      channel.provider,
      body,
      channel.secret,
      headers,
    );
    if (!valid) {
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  // Store event
  const eventId = `${EVENT_ID_PREFIX}${nanoid(16)}`;
  const now = Math.floor(Date.now() / 1000);

  const sourceIp =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";

  db.insert(schema.events)
    .values({
      id: eventId,
      channelId,
      headers: JSON.stringify(headers),
      body,
      method: c.req.method,
      sourceIp,
      receivedAt: now,
      attempts: 0,
    })
    .run();

  // Deliver asynchronously (don't await — return 200 fast)
  deliverEvent({
    id: eventId,
    channelId,
    headers,
    body,
    method: c.req.method,
    sourceIp,
    receivedAt: now,
    deliveredAt: null,
    attempts: 0,
  }).catch(() => {
    // Delivery failures are retried by the retry worker
  });

  return c.json({ received: true, eventId });
});

export default webhook;
