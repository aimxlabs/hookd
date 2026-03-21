import type { ServerWebSocket } from "@hono/node-ws";
import type { WSContext } from "hono/ws";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { parseClientMessage, type EventMessage } from "../shared/protocol.js";

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
      handleAck(msg.eventId);
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

  // Verify auth token
  const token = (conn as any).token;
  if (channel.authToken && channel.authToken !== token) {
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

function handleAck(eventId: string): void {
  const db = getDb();
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
