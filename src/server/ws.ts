import type { ServerWebSocket } from "@hono/node-ws";
import type { WSContext } from "hono/ws";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { getDb, schema } from "../db/index.js";
import { parseClientMessage, type EventMessage } from "../shared/protocol.js";
import { MAX_WS_MESSAGE_BYTES } from "../shared/constants.js";

interface AgentConnection {
  ws: WSContext;
  channelIds: Set<string>;
  authenticated: boolean;
}

// channelId → Set of connected agents
const channelSubscribers = new Map<string, Set<AgentConnection>>();
// ws → AgentConnection
const connections = new Map<WSContext, AgentConnection>();

export function handleWsOpen(ws: WSContext): void {
  const conn: AgentConnection = {
    ws,
    channelIds: new Set(),
    authenticated: false,
  };
  connections.set(ws, conn);
}

export function handleWsMessage(ws: WSContext, data: string): void {
  const conn = connections.get(ws);
  if (!conn) return;

  if (data.length > MAX_WS_MESSAGE_BYTES) {
    ws.send(JSON.stringify({ type: "error", message: "Message too large" }));
    return;
  }

  const msg = parseClientMessage(data);
  if (!msg) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
    return;
  }

  switch (msg.type) {
    case "auth":
      handleAuth(conn, msg.token);
      break;
    case "subscribe":
      handleSubscribe(conn, msg.channelId);
      break;
    case "ack":
      handleAck(conn, msg.eventId);
      break;
    case "ping":
      ws.send(JSON.stringify({ type: "pong" }));
      break;
  }
}

export function handleWsClose(ws: WSContext): void {
  const conn = connections.get(ws);
  if (!conn) return;

  for (const channelId of conn.channelIds) {
    const subs = channelSubscribers.get(channelId);
    if (subs) {
      subs.delete(conn);
      if (subs.size === 0) channelSubscribers.delete(channelId);
    }
  }
  connections.delete(ws);
}

function handleAuth(conn: AgentConnection, token: string): void {
  // For now, auth is per-channel (verified on subscribe).
  // Mark connection as authenticated with the provided token.
  conn.authenticated = true;
  (conn as any).token = token;
  conn.ws.send(JSON.stringify({ type: "auth_ok" }));
}

function handleSubscribe(conn: AgentConnection, channelId: string): void {
  const db = getDb();
  const [channel] = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .all();

  if (!channel) {
    conn.ws.send(
      JSON.stringify({ type: "error", message: `Channel ${channelId} not found` }),
    );
    return;
  }

  // Verify auth token (timing-safe comparison to prevent timing attacks)
  const token = (conn as any).token as string | undefined;
  if (
    !token ||
    token.length !== channel.authToken.length ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(channel.authToken))
  ) {
    conn.ws.send(
      JSON.stringify({ type: "auth_error", message: "Invalid token for channel" }),
    );
    return;
  }

  conn.channelIds.add(channelId);
  if (!channelSubscribers.has(channelId)) {
    channelSubscribers.set(channelId, new Set());
  }
  channelSubscribers.get(channelId)!.add(conn);

  conn.ws.send(JSON.stringify({ type: "subscribed", channelId }));
}

function handleAck(conn: AgentConnection, eventId: string): void {
  const db = getDb();

  // Only allow acking events that belong to channels this connection is subscribed to
  const [event] = db
    .select({ channelId: schema.events.channelId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .all();

  if (!event || !conn.channelIds.has(event.channelId)) {
    conn.ws.send(
      JSON.stringify({ type: "error", message: "Cannot ack event — not subscribed to its channel" }),
    );
    return;
  }

  db.update(schema.events)
    .set({ deliveredAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.events.id, eventId))
    .run();
}

export function pushEventToSubscribers(event: EventMessage): number {
  const subs = channelSubscribers.get(event.channelId);
  if (!subs || subs.size === 0) return 0;

  const payload = JSON.stringify(event);
  let delivered = 0;

  for (const conn of subs) {
    try {
      conn.ws.send(payload);
      delivered++;
    } catch {
      // Connection might be dead — will be cleaned up on close
    }
  }

  return delivered;
}

export function getSubscriberCount(channelId: string): number {
  return channelSubscribers.get(channelId)?.size ?? 0;
}

export function clearConnections(): void {
  channelSubscribers.clear();
  connections.clear();
}
