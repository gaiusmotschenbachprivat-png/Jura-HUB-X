// @vitest-environment node
/**
 * Kompatibilität der Backups zwischen Desktop-App (Rust) und Browser-Version.
 * Läuft nur mit Umgebungsvariablen (siehe tests/backup-compat.sh):
 *   RUST_BACKUP   – Backup, das die Desktop-App (Rust) erstellt hat
 *   TS_BACKUP_OUT – hierhin schreibt die Browser-Version ein eigenes Backup
 */
import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { buildBackup, extractBackup, verifyBackup } from "./backup";
import { MemoryBlobStore } from "./blobs";
import { configure, migrate } from "./db";
import * as areas from "./repo/areas";
import * as nodes from "./repo/nodes";
import * as notes from "./repo/notes";
import * as documents from "./repo/documents";
import { search, rebuild } from "./search";
import { dbFromBytes, dbToBytes, type Sqlite3Like } from "./sqliteBytes";
import { sqlite3 } from "./testing";

const RUST = process.env.RUST_BACKUP;
const OUT = process.env.TS_BACKUP_OUT;

describe.skipIf(!RUST || !OUT)("Backup-Kompatibilität Desktop ↔ Browser", () => {
  it("liest ein Desktop-Backup und schreibt eines für den Desktop", async () => {
    const s = (await sqlite3()) as unknown as Sqlite3Like;
    const open = (b: Uint8Array) => dbFromBytes(s, b);
    const file = new Blob([fs.readFileSync(RUST!)]);
    const rep = await verifyBackup(file, open);
    expect(rep.problems).toEqual([]);
    expect(rep.ok).toBe(true);

    const ex = await extractBackup(file, open);
    const db = open(ex.dbBytes);
    configure(db);
    migrate(db);
    rebuild(db);
    const blobs = new MemoryBlobStore();
    for (const [, b] of ex.files) await blobs.put(b);
    expect(search(db, "Gestaltungsrecht", null, 10).length).toBe(1);
    const docs = documents.list(db, blobs, { kind: "all" });
    expect(docs).toHaveLength(1);
    expect(docs[0]!.file_present).toBe(true);

    // In der Browser-Version weiterarbeiten und ein Backup für den Desktop schreiben
    const a = areas.list(db)[0]!;
    const n = nodes.create(db, { area_id: a.id, parent_id: null, kind: "note", title: "Vom Browser" });
    notes.save(db, n.id, JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Browser-Inhalt" }] }] }), "Browser-Inhalt");
    const parts: Uint8Array[] = [];
    await buildBackup({ dbBytes: dbToBytes(s, db), openDb: open, blobs, sink: { write: (c) => void parts.push(c.slice()) }, appVersion: "web-test", kind: "manual" });
    fs.writeFileSync(OUT!, Buffer.concat(parts));
  });
});
