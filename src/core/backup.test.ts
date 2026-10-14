// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildBackup, extractBackup, isAllowedEntry, verifyBackup } from "./backup";
import { MemoryBlobStore } from "./blobs";
import { crc32, readZipDirectory } from "./zip";
import * as areas from "./repo/areas";
import { dbFromBytes, dbToBytes, type Sqlite3Like } from "./sqliteBytes";
import { openTestDb, sqlite3 } from "./testing";

async function makeBackup() {
  const s = (await sqlite3()) as unknown as Sqlite3Like;
  const db = await openTestDb();
  areas.create(db, "Jura", "#112233");
  const blobs = new MemoryBlobStore();
  const { sha256 } = await blobs.put(new TextEncoder().encode("%PDF-1.4 Testinhalt"));
  db.run("INSERT INTO blobs (sha256, size, mime, created_at) VALUES (?1, 19, 'application/pdf', 'x')", [sha256]);
  const parts: Uint8Array[] = [];
  const res = await buildBackup({
    dbBytes: dbToBytes(s, db),
    openDb: (b) => dbFromBytes(s, b),
    blobs,
    sink: { write: (c) => void parts.push(c.slice()) },
    appVersion: "test",
    kind: "manual",
  });
  return { s, file: new Blob(parts as Uint8Array<ArrayBuffer>[]), res, sha256 };
}

describe("Backups der Browser-Version", () => {
  it("CRC-32 stimmt", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("erstellt, prüft und entpackt ein Backup", async () => {
    const { s, file, res, sha256 } = await makeBackup();
    expect(res.fileCount).toBe(1);
    const names = (await readZipDirectory(file)).map((e) => e.name).sort();
    expect(names).toEqual([`files/${sha256.slice(0, 2)}/${sha256}`, "manifest.json", "studium.sqlite"]);
    const rep = await verifyBackup(file, (b) => dbFromBytes(s, b));
    expect(rep.problems).toEqual([]);
    expect(rep.ok).toBe(true);
    const ex = await extractBackup(file, (b) => dbFromBytes(s, b));
    expect(ex.files.size).toBe(1);
    const restored = dbFromBytes(s, ex.dbBytes);
    expect(restored.value("SELECT name FROM areas")).toBe("Jura");
  });

  it("erkennt beschädigte Backups", async () => {
    const { s, file } = await makeBackup();
    const bytes = new Uint8Array(await file.arrayBuffer());
    // ein Byte im PDF-Inhalt verändern (stored, daher im Klartext)
    const idx = new TextDecoder("latin1").decode(bytes).indexOf("Testinhalt");
    bytes[idx] = bytes[idx]! ^ 0xff;
    const rep = await verifyBackup(new Blob([bytes]), (b) => dbFromBytes(s, b));
    expect(rep.ok).toBe(false);
    expect(rep.problems.join()).toMatch(/Prüfsumme/);
    const cut = await verifyBackup(new Blob([bytes.slice(0, 100)]), (b) => dbFromBytes(s, b));
    expect(cut.ok).toBe(false);
  });

  it("lässt nur bekannte Eintragsnamen zu", () => {
    const sha = "ab" + "0".repeat(62);
    expect(isAllowedEntry(`files/ab/${sha}`)).toBe(true);
    expect(isAllowedEntry(`files/cd/${sha}`)).toBe(false);
    expect(isAllowedEntry("../studium.sqlite")).toBe(false);
    expect(isAllowedEntry("files/ab/../../x")).toBe(false);
  });
});
