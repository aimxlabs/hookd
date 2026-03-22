// Public API for programmatic usage
export { createApp, startServer, type ServerOptions } from "./server/index.js";
export { initDb, initMemoryDb, closeDb, getDb, schema } from "./db/index.js";
export type { Channel, WebhookEvent, Provider } from "./shared/types.js";
export type {
  ClientMessage,
  ServerMessage,
  EventMessage,
} from "./shared/protocol.js";
export {
  DEFAULT_PORT,
  DEFAULT_HOST,
  CHANNEL_ID_PREFIX,
  EVENT_ID_PREFIX,
} from "./shared/constants.js";
