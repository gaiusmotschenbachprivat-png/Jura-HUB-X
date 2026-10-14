/**
 * Minimales ZIP-Lesen und -Schreiben für Backups im Browser.
 *
 * - Schreiben: „stored“ (Dokumente sind meist schon komprimiert) oder „deflate“
 *   (Datenbank, Inhaltsliste). Ohne ZIP64 – Backups über 4 GB lehnt die
 *   Browser-Version mit klarer Meldung ab.
 * - Lesen: wahlfreier Zugriff über `Blob.slice`, damit große Backups nicht ganz in
 *   den Arbeitsspeicher müssen. Versteht ZIP64 (Backups der Desktop-App).
 *
 * Kompression über die eingebauten `CompressionStream`/`DecompressionStream`.
 */
import { CoreError } from "./errors";

const enc = new TextEncoder();
const LIMIT = 0xffffffff;

// ---- CRC-32 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

async function pump(input: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([input as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export const deflateRaw = (b: Uint8Array) => pump(b, new CompressionStream("deflate-raw"));
export const inflateRaw = (b: Uint8Array) => pump(b, new DecompressionStream("deflate-raw"));

// ---- Schreiben ----

export interface ZipSink {
  write(chunk: Uint8Array): Promise<void> | void;
}

interface CentralEntry {
  name: Uint8Array;
  crc: number;
  csize: number;
  usize: number;
  method: number;
  offset: number;
  time: number;
  date: number;
}

function dosTime(d: Date) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const TOO_BIG = "Das Backup wäre größer als 4 GB. Das unterstützt die Browser-Version nicht – bitte nutze dafür die Desktop-App.";

export class ZipWriter {
  private offset = 0;
  private entries: CentralEntry[] = [];
  constructor(private sink: ZipSink) {}

  private async out(b: Uint8Array) {
    await this.sink.write(b);
    this.offset += b.length;
    if (this.offset >= LIMIT) throw CoreError.invalid(TOO_BIG);
  }

  /**
   * Fügt einen Eintrag hinzu. Bei „stored“ wird `data` (Blob) stückweise gelesen:
   * zuerst für die Prüfsumme, dann zum Schreiben. Liefert den Inhalt nicht zurück.
   */
  async add(name: string, data: Blob | Uint8Array, method: "stored" | "deflate", onChunk?: (c: Uint8Array) => void) {
    const nameBytes = enc.encode(name);
    const { time, date } = dosTime(new Date());
    let crc = 0;
    let usize = 0;
    let payload: Uint8Array | null = null;
    let blob: Blob | null = null;
    if (method === "deflate" || data instanceof Uint8Array) {
      const raw = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
      crc = crc32(raw);
      usize = raw.length;
      onChunk?.(raw);
      payload = method === "deflate" ? await deflateRaw(raw) : raw;
    } else {
      blob = data;
      usize = blob.size;
      for await (const c of chunks(blob)) {
        crc = crc32(c, crc);
        onChunk?.(c);
      }
    }
    const csize = payload ? payload.length : usize;
    if (usize >= LIMIT || csize >= LIMIT || this.offset + csize >= LIMIT) throw CoreError.invalid(TOO_BIG);
    const m = method === "deflate" ? 8 : 0;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // UTF-8-Namen
    h.setUint16(8, m, true);
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, csize, true);
    h.setUint32(22, usize, true);
    h.setUint16(26, nameBytes.length, true);
    h.setUint16(28, 0, true);
    const offset = this.offset;
    await this.out(new Uint8Array(h.buffer));
    await this.out(nameBytes);
    if (payload) await this.out(payload);
    else for await (const c of chunks(blob!)) await this.out(c);
    this.entries.push({ name: nameBytes, crc, csize, usize, method: m, offset, time, date });
  }

  async finish() {
    const start = this.offset;
    for (const e of this.entries) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 20, true);
      h.setUint16(8, 0x0800, true);
      h.setUint16(10, e.method, true);
      h.setUint16(12, e.time, true);
      h.setUint16(14, e.date, true);
      h.setUint32(16, e.crc, true);
      h.setUint32(20, e.csize, true);
      h.setUint32(24, e.usize, true);
      h.setUint16(28, e.name.length, true);
      h.setUint32(42, e.offset, true);
      await this.out(new Uint8Array(h.buffer));
      await this.out(e.name);
    }
    const size = this.offset - start;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, start, true);
    await this.out(new Uint8Array(end.buffer));
  }
}

async function* chunks(b: Blob, size = 4 * 1024 * 1024): AsyncGenerator<Uint8Array> {
  for (let off = 0; off < b.size; off += size) yield new Uint8Array(await b.slice(off, off + size).arrayBuffer());
}

// ---- Lesen ----

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  localOffset: number;
}

const BAD = "Die Datei ist kein lesbares Archiv (abgebrochen oder beschädigt).";

async function bytes(b: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await b.slice(start, end).arrayBuffer());
}

/** Liest das Inhaltsverzeichnis eines ZIP-Archivs. Wirft bei unlesbaren Dateien. */
export async function readZipDirectory(file: Blob): Promise<ZipEntry[]> {
  const tailLen = Math.min(file.size, 22 + 65535 + 20);
  if (tailLen < 22) throw new Error(BAD);
  const tailStart = file.size - tailLen;
  const tail = await bytes(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(BAD);
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  // ZIP64-Verzeichnisende
  if (eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) {
    const z64 = Number(tail.getBigUint64(eocd - 20 + 8, true));
    const r = await bytes(file, z64, z64 + 56);
    if (r.getUint32(0, true) !== 0x06064b50) throw new Error(BAD);
    count = Number(r.getBigUint64(32, true));
    cdSize = Number(r.getBigUint64(40, true));
    cdOffset = Number(r.getBigUint64(48, true));
  }
  if (cdOffset + cdSize > file.size || count > 1_000_000) throw new Error(BAD);
  const cd = await bytes(file, cdOffset, cdOffset + cdSize);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw new Error(BAD);
    const method = cd.getUint16(p + 10, true);
    const crc = cd.getUint32(p + 16, true);
    let csize = cd.getUint32(p + 20, true);
    let usize = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true);
    const xlen = cd.getUint16(p + 30, true);
    const clen = cd.getUint16(p + 32, true);
    let localOffset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    // ZIP64-Zusatzfeld
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = cd.getUint16(x, true);
      const len = cd.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        if (usize === LIMIT) (usize = Number(cd.getBigUint64(q, true))), (q += 8);
        if (csize === LIMIT) (csize = Number(cd.getBigUint64(q, true))), (q += 8);
        if (localOffset === LIMIT) localOffset = Number(cd.getBigUint64(q, true));
      }
      x += 4 + len;
    }
    out.push({ name, method, crc, csize, usize, localOffset });
    p = xend + clen;
  }
  return out;
}

/** Rohdaten (komprimiert) eines Eintrags als Blob-Ausschnitt. */
export async function entryRaw(file: Blob, e: ZipEntry): Promise<Blob> {
  const h = await bytes(file, e.localOffset, e.localOffset + 30);
  if (h.getUint32(0, true) !== 0x04034b50) throw new Error(BAD);
  const start = e.localOffset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  if (start + e.csize > file.size) throw new Error(BAD);
  return file.slice(start, start + e.csize);
}

/** Entpackter Inhalt eines Eintrags als Blob (stored: ohne Kopie). */
export async function entryData(file: Blob, e: ZipEntry, maxInflated = 2 * 1024 * 1024 * 1024): Promise<Blob> {
  const raw = await entryRaw(file, e);
  if (e.method === 0) return raw;
  if (e.method !== 8) throw new Error("Nicht unterstützte Kompression im Archiv.");
  if (e.usize > maxInflated) throw new Error("Eintrag unplausibel groß.");
  const data = await inflateRaw(new Uint8Array(await raw.arrayBuffer()));
  return new Blob([data as Uint8Array<ArrayBuffer>]);
}
