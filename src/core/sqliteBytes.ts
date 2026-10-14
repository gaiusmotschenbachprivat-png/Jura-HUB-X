/** Datenbank als Bytes laden bzw. exportieren (Backups, Prüfungen). */
import { Db, type RawDb } from "./db";

// Die Typen von sqlite-wasm sind sehr umfangreich; hier genügt der benutzte Teil.
export interface Sqlite3Like {
  oo1: { DB: new (name: string) => unknown };
  wasm: { allocFromTypedArray(b: Uint8Array): number };
  capi: {
    sqlite3_deserialize(db: unknown, schema: string, p: number, sz: number, bufsz: number, flags: number): number;
    sqlite3_js_db_export(db: unknown): Uint8Array;
    SQLITE_DESERIALIZE_FREEONCLOSE: number;
    SQLITE_DESERIALIZE_RESIZEABLE: number;
  };
}

/** Öffnet eine Kopie der Datenbank-Bytes im Arbeitsspeicher. */
export function dbFromBytes(sqlite3: Sqlite3Like, bytes: Uint8Array): Db {
  const raw = new sqlite3.oo1.DB(":memory:") as RawDb & { pointer: number; checkRc(rc: number): void };
  const p = sqlite3.wasm.allocFromTypedArray(bytes);
  const rc = sqlite3.capi.sqlite3_deserialize(
    raw.pointer,
    "main",
    p,
    bytes.length,
    bytes.length,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
  );
  raw.checkRc(rc);
  return new Db(raw);
}

/** Konsistenter Schnappschuss einer geöffneten Datenbank. */
export function dbToBytes(sqlite3: Sqlite3Like, db: Db): Uint8Array {
  return sqlite3.capi.sqlite3_js_db_export(db.raw);
}
