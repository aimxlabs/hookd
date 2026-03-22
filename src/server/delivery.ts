import { eq, and, isNull, lt } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { pushEventToSubscribers } from "./ws.js";
import type { EventMessage } from "../shared/protocol.js";
import type { WebhookEvent } from "../shared/types.js";
import {
  WS_ACK_TIMEOUT_MS,
  WS_MAX_RETRIES,
  DEFAULT_RETENTION_DAYS,
  PRUNE_INTERVAL_MS,
} from "../shared/constants.js";

export async function deliverEvent(event: WebhookEvent): Promise<void> {
  // Build the WS event message
  const eventMessage: EventMessage = {
    type: "event",
    eventId: event.id,
    channelId: event.channelId,
    receivedAt: new Date(event.receivedAt * 1000).toISOString(),
    headers: event.headers,
    body: event.body,
    method: event.method,
    ip: event.sourceIp,
  };

  // Try WebSocket delivery
  const wsDelivered = pushEventToSubscribers(eventMessage);

  // If no WS subscribers, try HTTP callback
  if (wsDelivered === 0) {
    const db = getDb();
    const [channel] = db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, event.channelId))
      .all();

    if (channel?.callbackUrl) {
      await deliverViaHttp(channel.callbackUrl, event);
    }
  }
}

/** Headers that are safe to forward from the original webhook to the callback. */
const FORWARDED_HEADER_ALLOWLIST = new Set([
  "content-type",
  "x-github-event",
  "x-github-delivery",
  "x-hub-signature-256",
  "x-stripe-webhook-id",
  "x-slack-signature",
  "x-slack-request-timestamp",
  "user-agent",
]);

/** Pick only safe headers from the original webhook to forward. */
function safeHeaders(raw: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (FORWARDED_HEADER_ALLOWLIST.has(key.toLowerCase())) {
      safe[key] = value;
    }
  }
  return safe;
}

async function deliverViaHttp(
  callbackUrl: string,
  event: WebhookEvent,
): Promise<boolean> {
  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hookd-Event-Id": event.id,
        "X-Hookd-Channel-Id": event.channelId,
        ...safeHeaders(
          typeof event.headers === "string"
            ? JSON.parse(event.headers)
            : event.headers,
        ),
      },
      body: event.body,
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      const db = getDb();
      db.update(schema.events)
        .set({ deliveredAt: Math.floor(Date.now() / 1000) })
        .where(eq(schema.events.id, event.id))
        .run();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function retryUndeliveredEvents(): void {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - WS_ACK_TIMEOUT_MS / 1000;

  const undelivered = db
    .select()
    .from(schema.events)
    .where(
      and(
        isNull(schema.events.deliveredAt),
        lt(schema.events.receivedAt, cutoff),
        lt(schema.events.attempts, WS_MAX_RETRIES),
      ),
    )
    .all();

  for (const event of undelivered) {
    const parsedHeaders = JSON.parse(event.headers) as Record<string, string>;
    db.update(schema.events)
      .set({ attempts: event.attempts + 1 })
      .where(eq(schema.events.id, event.id))
      .run();

    deliverEvent({
      ...event,
      headers: parsedHeaders,
      deliveredAt: event.deliveredAt ?? null,
    });
  }
}

export function pruneOldEvents(
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): number {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 24 * 60 * 60;

  const result = db
    .delete(schema.events)
    .where(lt(schema.events.receivedAt, cutoff))
    .run();

  return result.changes;
}

let retryInterval: ReturnType<typeof setInterval> | null = null;
let pruneInterval: ReturnType<typeof setInterval> | null = null;

export function startDeliveryWorkers(): void {
  // Retry undelivered events every 30 seconds
  retryInterval = setInterval(retryUndeliveredEvents, 30_000);

  // Prune old events every hour
  pruneInterval = setInterval(() => pruneOldEvents(), PRUNE_INTERVAL_MS);
}

export function stopDeliveryWorkers(): void {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
  if (pruneInterval) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
}
