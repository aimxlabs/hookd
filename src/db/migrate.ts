import type Database from "better-sqlite3";

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT,
      secret TEXT,
      callback_url TEXT,
      auth_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      headers TEXT NOT NULL,
      body TEXT NOT NULL,
      method TEXT NOT NULL,
      source_ip TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      delivered_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_events_channel_received
      ON events(channel_id, received_at);

    CREATE INDEX IF NOT EXISTS idx_events_undelivered
      ON events(delivered_at);
  `);

  // Migration: add owner_address column for hello-message auth
  const columns = db.pragma("table_info(channels)") as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "owner_address")) {
    db.exec(`ALTER TABLE channels ADD COLUMN owner_address TEXT;`);
  }
}
