/// <reference lib="webworker" />
/**
 * Daten-Worker der Browser-/iPad-Version. Hält die SQLite-Datenbank und den
 * Dokumentenspeicher und beantwortet Aufrufe der Oberfläche nacheinander.
 * Es gibt keinen Netzwerkzugriff.
 *
 * Speicher:
 * 1. bevorzugt das private Dateisystem (OPFS) mit synchronem Zugriff („SAH-Pool“),
 * 2. sonst IndexedDB (Datenbank im Speicher, nach jeder Änderung gesichert).
 */
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

import { configure, Db, MIGRATIONS, migrate, schemaVersion, type RawDb } from "../core/db";
import { CoreError, toCmdError } from "../core/errors";
import { dbFromBytes, dbToBytes, type Sqlite3Like } from "../core/sqliteBytes";
import { fileStamp } from "../core/util";
import { OpfsBackupStore } from "./backupStore";
import { Idb, IdbBackupStore, IdbBlobStore } from "./idb";
import { OpfsBlobStore, opfsRoot, subdir, writeFile } from "./opfsBlobs";
import type { Ready, Request, Response } from "./protocol";
import { createService, type Env } from "./service";

const DB_NAME = "/studium.sqlite";
const BUSY = "Studium OS ist bereits in einem anderen Tab oder Fenster geöffnet. Bitte schließe es dort und lade diese Seite neu.";

interface Pool {
  OpfsSAHPoolDb: new (name: string) => RawDb;
  importDb(name: string, bytes: Uint8Array): unknown;
}

/** Nur ein Tab darf die Daten gleichzeitig bearbeiten. */
async function acquireLock(): Promise<void> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return;
  const tryOnce = () =>
    new Promise<boolean>((resolve) => {
      void locks.request("studium-os-daten", { ifAvailable: true }, (lock) => {
        resolve(!!lock);
        // Sperre halten, solange der Worker lebt
        return lock ? new Promise<void>(() => {}) : undefined;
      });
    });
  // Beim Neuladen gibt die vorige Seite die Sperre erst kurz danach frei – etwas warten.
  for (let i = 0; i < 12; i++) {
    if (await tryOnce()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new CoreError("busy", BUSY);
}

/** Nach jeder Änderung zu sichernde Datenbank (nur IndexedDB-Modus). */
let persist: (() => Promise<void>) | null = null;

async function start() {
  await acquireLock();
  const sqlite3 = await sqlite3InitModule();
  const s = sqlite3 as unknown as Sqlite3Like;
  let pool: Pool | null = null;
  let opfsError = "";
  try {
    pool = (await (sqlite3 as unknown as { installOpfsSAHPoolVfs(o: object): Promise<Pool> }).installOpfsSAHPoolVfs({
      name: "studium-os",
      directory: "studium-os-db",
      initialCapacity: 8,
    })) as Pool;
  } catch (e) {
    opfsError = String((e as Error)?.message ?? e);
    if (/NoModificationAllowed|Access Handles cannot be created/i.test(opfsError)) throw new CoreError("busy", BUSY);
  }

  if (pool) {
    const p = pool;
    const root = await opfsRoot();
    const base = await subdir(root, "studium-os");
    const open = async (): Promise<Db> => {
      const db = new Db(new p.OpfsSAHPoolDb(DB_NAME));
      configure(db);
      const v = schemaVersion(db);
      if (v > 0 && v < MIGRATIONS.length) {
        await writeFile(await subdir(base, "pre-migration"), `studium-schema${v}-${fileStamp()}.sqlite`, dbToBytes(s, db));
      }
      migrate(db);
      return db;
    };
    let db = await open();
    const env: Env = {
      sqlite3: s,
      blobs: await OpfsBlobStore.open(base),
      backups: new OpfsBackupStore(base),
      storageLabel: "Privater Dateispeicher dieser Web-App (nur auf diesem Gerät)",
      db: () => db,
      async replaceDatabase(bytes) {
        db.raw.close();
        try {
          p.importDb(DB_NAME, bytes);
        } finally {
          db = await open();
        }
      },
    };
    return createService(env);
  }

  // Ersatz: IndexedDB
  let idb: Idb;
  try {
    idb = await Idb.open();
  } catch (e) {
    throw new CoreError(
      "unsupported",
      `Dieser Browser bietet keinen lokalen Speicher an (z. B. im privaten Modus). Bitte nutze Safari ab iPadOS 16.4 im normalen Modus. (Technische Angabe: ${opfsError.slice(0, 120)} / ${String((e as Error)?.message ?? e).slice(0, 120)})`,
    );
  }
  const open = async (bytes: Uint8Array | undefined): Promise<Db> => {
    const db = bytes ? dbFromBytes(s, bytes) : new Db(new s.oo1.DB(":memory:") as unknown as RawDb);
    configure(db);
    const v = schemaVersion(db);
    if (v > 0 && v < MIGRATIONS.length) await idb.put("kv", `pre-migration-${v}-${fileStamp()}`, dbToBytes(s, db));
    migrate(db);
    return db;
  };
  const stored = await idb.get<ArrayBuffer>("kv", "db");
  let db = await open(stored ? new Uint8Array(stored) : undefined);
  const capi = (sqlite3 as unknown as { capi: { sqlite3_total_changes(p: number): number } }).capi;
  const ptr = () => (db.raw as unknown as { pointer: number }).pointer;
  let saved = -1;
  persist = async () => {
    const n = capi.sqlite3_total_changes(ptr());
    if (n === saved) return;
    await idb.put("kv", "db", dbToBytes(s, db).slice().buffer);
    saved = n;
  };
  await persist();
  const env: Env = {
    sqlite3: s,
    blobs: await IdbBlobStore.open(idb),
    backups: new IdbBackupStore(idb),
    storageLabel: "Browser-Datenbank (IndexedDB) dieser Web-App (nur auf diesem Gerät)",
    db: () => db,
    async replaceDatabase(bytes) {
      db.raw.close();
      db = await open(bytes);
      saved = -1;
      await persist!();
    },
  };
  return createService(env);
}

const ready = start();
ready.then(
  () => postMessage({ ready: true } satisfies Ready),
  (e) => postMessage({ ready: false, error: toCmdError(e) } satisfies Ready),
);

// Aufrufe strikt nacheinander abarbeiten (Wiederherstellung, Backups und
// Schreibvorgänge dürfen sich nicht überlappen).
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (ev: MessageEvent<Request>) => {
  const { id, method, args } = ev.data;
  queue = queue.then(async () => {
    let res: Response;
    try {
      const service = await ready;
      const fn = (service as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
      if (typeof fn !== "function") throw CoreError.invalid("Unbekannter Befehl.");
      const value = await fn(...args);
      // Erst bestätigen, wenn die Änderung dauerhaft gespeichert ist.
      if (persist) await persist();
      res = { id, ok: true, value };
    } catch (e) {
      if (persist) await persist().catch(() => {});
      res = { id, ok: false, error: toCmdError(e) };
    }
    const transfer: Transferable[] = [];
    if (res.ok && res.value instanceof Uint8Array) transfer.push(res.value.buffer as ArrayBuffer);
    postMessage(res, transfer);
  });
};
