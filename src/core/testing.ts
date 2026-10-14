/**
 * Hilfen für Tests des Kerns unter Node: frische In-Memory-Datenbank mit
 * allen Migrationen. Nur in `*.test.ts` mit `// @vitest-environment node` verwenden.
 */
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

import { MemoryBlobStore } from "./blobs";
import { configure, Db, migrate, type RawDb } from "./db";

let sqlite: Awaited<ReturnType<typeof sqlite3InitModule>> | null = null;

export async function sqlite3() {
  sqlite ??= await sqlite3InitModule();
  return sqlite;
}

export async function openTestDb(): Promise<Db> {
  const s = await sqlite3();
  const db = new Db(new s.oo1.DB(":memory:") as unknown as RawDb);
  configure(db);
  migrate(db);
  return db;
}

export async function testCtx() {
  return { db: await openTestDb(), blobs: new MemoryBlobStore() };
}
