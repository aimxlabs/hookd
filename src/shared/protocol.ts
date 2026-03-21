// Client → Server messages
export interface AuthMessage {
  type: "auth";
  token: string;
}

export interface SubscribeMessage {
  type: "subscribe";
  channelId: string;
}

export interface AckMessage {
  type: "ack";
  eventId: string;
}

export interface PingMessage {
  type: "ping";
}

export type ClientMessage =
  | AuthMessage
  | SubscribeMessage
  | AckMessage
  | PingMessage;

// Server → Client messages
export interface AuthOkMessage {
  type: "auth_ok";
}

export interface AuthErrorMessage {
  type: "auth_error";
  message: string;
}

export interface SubscribedMessage {
  type: "subscribed";
  channelId: string;
}

export interface EventMessage {
  type: "event";
  eventId: string;
  channelId: string;
  receivedAt: string;
  headers: Record<string, string>;
  body: string;
  method: string;
  ip: string;
}

export interface PongMessage {
  type: "pong";
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerMessage =
  | AuthOkMessage
  | AuthErrorMessage
  | SubscribedMessage
  | EventMessage
  | PongMessage
  | ErrorMessage;

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (!msg || typeof msg.type !== "string") return null;
    return msg as ClientMessage;
  } catch {
    return null;
  }
}
