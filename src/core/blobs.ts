/**
 * Inhaltsadressierter Dateispeicher (Port von `files.rs`, Teil BlobStore).
 *
 * Im Browser liegen die Dateien im privaten Dateisystem der Website (OPFS) unter
 * `files/<xx>/<sha256>`, in Tests im Arbeitsspeicher. Dateien werden nie verändert.
 * Die Schnittstelle ist asynchron; Datenbank-Transaktionen laufen synchron davor
 * oder danach, nie über ein `await` hinweg.
 */
import { sha256 } from "@noble/hashes/sha2.js";

import { CoreError } from "./errors";
import { isSha256Hex, toHex } from "./util";

export interface BlobStore {
  /** Ist die Datei vorhanden? (synchron, aus einem beim Start geladenen Verzeichnis) */
  has(sha: string): boolean;
  /** Speichert Daten und liefert SHA-256 und Größe. Vorhandene Dateien bleiben unverändert. */
  put(data: Blob | Uint8Array): Promise<{ sha256: string; size: number }>;
  read(sha: string): Promise<Uint8Array>;
  /** Datei als Blob (ohne alles in den Speicher zu laden, wo möglich). */
  blob(sha: string): Promise<Blob>;
  remove(sha: string): Promise<void>;
  /** Alle gespeicherten SHA-256-Werte. */
  list(): string[];
  /** Ersetzt den gesamten Bestand (Wiederherstellung). */
  replaceAll?(entries: Map<string, Blob>): Promise<void>;
}

export function checkSha(sha: string): void {
  if (!isSha256Hex(sha)) throw CoreError.invalid("Ungültige Dateikennung.");
}

export const MISSING_FILE = "Die Datei fehlt im Dokumentenspeicher. Stelle sie aus einem Backup wieder her.";

/** SHA-256 eines Blobs, in Stücken gelesen (große PDFs passen nicht immer in den Speicher). */
export async function sha256Blob(data: Blob | Uint8Array): Promise<{ sha256: string; size: number }> {
  if (data instanceof Uint8Array) return { sha256: toHex(sha256(data)), size: data.length };
  const h = sha256.create();
  const chunk = 4 * 1024 * 1024;
  for (let off = 0; off < data.size; off += chunk) {
    h.update(new Uint8Array(await data.slice(off, off + chunk).arrayBuffer()));
  }
  return { sha256: toHex(h.digest()), size: data.size };
}

/** Speicher im Arbeitsspeicher (Tests). */
export class MemoryBlobStore implements BlobStore {
  readonly files = new Map<string, Uint8Array>();
  has(sha: string) {
    return this.files.has(sha);
  }
  async put(data: Blob | Uint8Array) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    const { sha256: sha } = await sha256Blob(bytes);
    if (!this.files.has(sha)) this.files.set(sha, bytes.slice());
    return { sha256: sha, size: bytes.length };
  }
  async read(sha: string) {
    checkSha(sha);
    const f = this.files.get(sha);
    if (!f) throw CoreError.notFound(MISSING_FILE);
    return f.slice();
  }
  async blob(sha: string) {
    return new Blob([(await this.read(sha)) as Uint8Array<ArrayBuffer>]);
  }
  async remove(sha: string) {
    checkSha(sha);
    this.files.delete(sha);
  }
  list() {
    return [...this.files.keys()];
  }
  async replaceAll(entries: Map<string, Blob>) {
    this.files.clear();
    for (const [sha, b] of entries) this.files.set(sha, new Uint8Array(await b.arrayBuffer()));
  }
}
