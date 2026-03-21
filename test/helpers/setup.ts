import { initMemoryDb, closeDb, type DB } from "../../src/db/index.js";

export function setupTestDb(): DB {
  return initMemoryDb();
}

export function teardownTestDb(): void {
  closeDb();
}
