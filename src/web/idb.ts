/**
 * Ersatzspeicher über IndexedDB, falls der Browser keinen synchronen
 * Dateizugriff im privaten Dateisystem (OPFS) bietet. IndexedDB wird von allen
 * Safari-Versionen seit Jahren unterstützt und speichert Blobs direkt.
 *
 * - Datenbank: liegt im Arbeitsspeicher und wird nach jeder Änderung vollständig
 *   (atomar, in einer IndexedDB-Transaktion) gesichert, bevor die Oberfläche
 *   die Bestätigung erhält.
 * - Dokumente: inhaltsadressiert als Blobs (`files`).
 * - Backups: als Blobs (`backups`).
 */
import { checkSha, MISSING_FILE, sha256Blob, type BlobStore } from "../core/blobs";
import { CoreError } from "../core/errors";
import type { BackupStore } from "./backupStore";

const NAME = "studium-os";
const STORES = ["kv", "files", "backups"] as const;
type Store = (typeof STORES)[number];

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Speichern abgebrochen."));
  });
}

export class Idb {
  private constructor(private db: IDBDatabase) {}

  static async open(): Promise<Idb> {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
    };
    return new Idb(await req(r));
  }

  async get<T>(store: Store, key: string): Promise<T | undefined> {
    return req(this.db.transaction(store, "readonly").objectStore(store).get(key)) as Promise<T | undefined>;
  }

  async put(store: Store, key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(store, "readwrite", { durability: "strict" } as IDBTransactionOptions);
    tx.objectStore(store).put(value, key);
    await done(tx);
  }

  async delete(store: Store, key: string): Promise<void> {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    await done(tx);
  }

  async keys(store: Store): Promise<string[]> {
    return (await req(this.db.transaction(store, "readonly").objectStore(store).getAllKeys())) as string[];
  }
}

export class IdbBlobStore implements BlobStore {
  private known = new Set<string>();
  private constructor(private idb: Idb) {}

  static async open(idb: Idb): Promise<IdbBlobStore> {
    const s = new IdbBlobStore(idb);
    for (const k of await idb.keys("files")) s.known.add(k);
    return s;
  }
  has(sha: string) {
    return this.known.has(sha);
  }
  list() {
    return [...this.known];
  }
  async put(data: Blob | Uint8Array) {
    const { sha256, size } = await sha256Blob(data);
    if (!this.known.has(sha256)) {
      // Als ArrayBuffer ablegen: Blobs aus Dateiauswahlen verweisen in Safari
      // teils nur auf die Originaldatei.
      const buf = data instanceof Uint8Array ? data.slice().buffer : await data.arrayBuffer();
      await this.idb.put("files", sha256, buf);
      this.known.add(sha256);
    }
    return { sha256, size };
  }
  async blob(sha: string) {
    checkSha(sha);
    const v = await this.idb.get<ArrayBuffer | Blob>("files", sha);
    if (!v) throw CoreError.notFound(MISSING_FILE);
    return v instanceof Blob ? v : new Blob([v]);
  }
  async read(sha: string) {
    return new Uint8Array(await (await this.blob(sha)).arrayBuffer());
  }
  async remove(sha: string) {
    checkSha(sha);
    await this.idb.delete("files", sha);
    this.known.delete(sha);
  }
}

interface StoredBackup {
  data: ArrayBuffer;
  created_at: string;
}

export class IdbBackupStore implements BackupStore {
  constructor(private idb: Idb) {}
  async list() {
    const out: { name: string; size: number; created_at: string }[] = [];
    for (const name of await this.idb.keys("backups")) {
      const v = await this.idb.get<StoredBackup>("backups", name);
      if (v) out.push({ name, size: v.data.byteLength, created_at: v.created_at });
    }
    return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async file(name: string) {
    const v = await this.idb.get<StoredBackup>("backups", name);
    if (!v) throw CoreError.notFound("Die Backup-Datei wurde nicht gefunden.");
    return new File([v.data], name, { type: "application/octet-stream" });
  }
  async writer(name: string) {
    const parts: Uint8Array[] = [];
    return {
      write: (c: Uint8Array) => void parts.push(c.slice()),
      close: async () => {
        const data = await new Blob(parts as Uint8Array<ArrayBuffer>[]).arrayBuffer();
        await this.idb.put("backups", name, { data, created_at: new Date().toISOString() } satisfies StoredBackup);
      },
      abort: () => {
        parts.length = 0;
      },
    };
  }
  async remove(name: string) {
    await this.idb.delete("backups", name);
  }
}
