import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { migrate } from "./migrate.js";

export type DB = BetterSQLite3Database<typeof schema>;

let db: DB | null = null;
let sqlite: Database.Database | null = null;

export function getDb(): DB {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

export function initDb(dbPath: string): DB {
  sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  db = drizzle(sqlite, { schema });
  migrate(sqlite);
  return db;
}

export function initMemoryDb(): DB {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");

  db = drizzle(sqlite, { schema });
  migrate(sqlite);
  return db;
}

export function closeDb(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}

export { schema };
