export const DEFAULT_PORT = 4801;
export const DEFAULT_HOST = "0.0.0.0";
export const DEFAULT_DB_PATH = "hookr.db";
export const DEFAULT_RETENTION_DAYS = 7;

export const CHANNEL_ID_PREFIX = "ch_";
export const EVENT_ID_PREFIX = "evt_";
export const TOKEN_PREFIX = "tok_";

export const WS_ACK_TIMEOUT_MS = 30_000;
export const WS_MAX_RETRIES = 3;
export const WS_RECONNECT_BASE_MS = 1_000;
export const WS_RECONNECT_MAX_MS = 30_000;

export const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export const MAX_BODY_BYTES = 1_048_576; // 1 MB
export const MAX_QUERY_LIMIT = 1000;
export const MAX_WS_MESSAGE_BYTES = 4096; // 4 KB — client messages are small JSON
