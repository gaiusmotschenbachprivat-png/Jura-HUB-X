// @vitest-environment node
import { describe, expect, it } from "vitest";

import { decodeInk, encodeInk } from "../lib/ink";
import { configure, Db, migrate, MIGRATIONS, schemaVersion, type RawDb } from "./db";
import * as annotations from "./repo/annotations";
import { sqlite3 } from "./testing";
import { newId, now } from "./util";

function insertDoc(db: Db): string {
  const sha = "b".repeat(64);
  const id = newId();
  const ts = now();
  db.run("INSERT OR IGNORE INTO blobs (sha256, size, mime, created_at) VALUES (?1, 13, 'application/pdf', ?2)", [sha, ts]);
  db.run(`INSERT INTO documents (id, blob_sha, title, original_name, ext, created_at, updated_at) VALUES (?1, ?2, 'Folien', 'folien.pdf', 'pdf', ?3, ?3)`, [id, sha, ts]);
  return id;
}

describe("Handschrift auf PDF-Seiten", () => {
  it("Migration 5 erhält Markierungen und erlaubt Handschrift", async () => {
    const s = await sqlite3();
    const db = new Db(new s.oo1.DB(":memory:") as unknown as RawDb);
    configure(db);
    migrate(db, MIGRATIONS.slice(0, 4));
    expect(schemaVersion(db)).toBe(4);
    const doc = insertDoc(db);
    db.run(
      `INSERT INTO annotations (id, document_id, page, kind, color, rects, quote, comment, created_at, updated_at)
       VALUES (?1, ?2, 3, 'highlight', 'gruen', '[{"x":0.1,"y":0.1,"w":0.2,"h":0.02}]', 'Trennungsprinzip', 'wichtig', ?3, ?3)`,
      [newId(), doc, now()],
    );
    migrate(db);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    const [h] = annotations.list(db, doc);
    expect(h).toMatchObject({ kind: "highlight", color: "gruen", quote: "Trennungsprinzip", comment: "wichtig", ink: "" });
    expect(db.value("PRAGMA foreign_key_check")).toBeUndefined();

    const strokes = [{ tool: "pen" as const, color: "#1d2433", size: 5, points: [[10, 10, 0.5], [200, 40, 0.7]] as [number, number, number][] }];
    const ink = encodeInk(strokes, 1.414);
    const a = annotations.create(db, { document_id: doc, page: 1, kind: "ink", ink });
    expect(decodeInk(a.ink)).toEqual(strokes);
    expect(a.ink.startsWith("v1|2000|2828\n")).toBe(true);
    // Zweites Anlegen auf derselben Seite ersetzt die Striche (eine Handschrift je Seite)
    const b = annotations.create(db, { document_id: doc, page: 1, kind: "ink", ink: encodeInk([], 1) || "v1|2000|2000" });
    expect(b.id).toBe(a.id);
    expect(decodeInk(b.ink)).toEqual([]);
    expect(() => annotations.create(db, { document_id: doc, page: 2, kind: "ink", ink: "<svg onload=x>" })).toThrow("Ungültige Handschrift.");
    expect(() => annotations.update(db, a.id, { ink: "v1|1|1\n'); DROP TABLE x" })).toThrow("Ungültige Handschrift.");
    expect(annotations.update(db, a.id, { ink })).toMatchObject({ ink });
    // Löschen des Dokuments entfernt die Handschrift mit
    db.run("DELETE FROM documents WHERE id = ?1", [doc]);
    expect(annotations.list(db, doc)).toHaveLength(0);
  });

  it("Kodierung: leere Striche ergeben nichts, ungültige Zeilen werden verworfen", () => {
    expect(encodeInk([], 1.4)).toBe("");
    expect(decodeInk("")).toEqual([]);
    expect(decodeInk("v1|2000|2828\nquatsch\npen|#123456|4|1,2,50")).toEqual([{ tool: "pen", color: "#123456", size: 4, points: [[1, 2, 0.5]] }]);
  });
});
