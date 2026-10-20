// @vitest-environment node
import { describe, expect, it } from "vitest";

import { configure } from "./db";
import { mergeDatabases } from "./merge";
import * as annotations from "./repo/annotations";
import * as areas from "./repo/areas";
import * as cards from "./repo/cards";
import * as nodes from "./repo/nodes";
import * as notes from "./repo/notes";
import { dbFromBytes, dbToBytes, type Sqlite3Like } from "./sqliteBytes";
import { openTestDb, sqlite3 } from "./testing";
import { newId, now } from "./util";

const doc = (text: string) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const tick = () => new Promise((r) => setTimeout(r, 5));

async function twoDevices() {
  const s = (await sqlite3()) as unknown as Sqlite3Like;
  const a = await openTestDb();
  const area = areas.create(a, "Jura", "#123456");
  const course = nodes.create(a, { area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
  const note = nodes.create(a, { area_id: area.id, parent_id: course.id, kind: "note", title: "1. Vorlesung", content_json: doc("Anfang"), plain_text: "Anfang" });
  // Gerät B startet mit einer Kopie (z. B. aus einem Backup)
  const b = dbFromBytes(s, dbToBytes(s, a));
  configure(b);
  return { a, b, area, course, note };
}

describe("Abgleich zweier Geräte über eine Backup-Datei", () => {
  it("neue Einträge kommen hinzu, jüngere Änderungen gewinnen", async () => {
    const { a, b, area, course } = await twoDevices();
    await tick();
    const onB = nodes.create(b, { area_id: area.id, parent_id: course.id, kind: "note", title: "2. Vorlesung (Laptop)", content_json: doc("Laptop"), plain_text: "Laptop" });
    const card = cards.create(b, { area_id: area.id, node_id: course.id, kind: "definition", front: "Definiere: Angebot", back: "…" });
    nodes.update(b, course.id, { title: "BGB Allgemeiner Teil" });
    await tick();
    nodes.update(a, course.id, { meta: { room: "H 1" } }); // A ändert später → A gewinnt

    const preview = mergeDatabases(a, b, { dryRun: true });
    expect(preview.added).toMatchObject({ nodes: 1, notes: 1, flashcards: 1 });
    expect(() => nodes.get(a, onB.id)).toThrow();

    const rep = mergeDatabases(a, b);
    expect(rep.added).toMatchObject({ nodes: 1, notes: 1, flashcards: 1 });
    expect(nodes.get(a, onB.id).title).toBe("2. Vorlesung (Laptop)");
    expect(a.value("SELECT plain_text FROM notes WHERE node_id = ?1", [onB.id])).toBe("Laptop");
    expect(cards.get(a, card.id).front).toBe("Definiere: Angebot");
    const c = nodes.get(a, course.id);
    expect(c.title).toBe("BGB AT");
    expect(c.meta).toMatchObject({ room: "H 1" });

    // Zweiter Abgleich ändert nichts mehr
    const again = mergeDatabases(a, b);
    expect(again.added).toEqual({});
    expect(again.updated).toEqual({});
    expect(a.value("PRAGMA foreign_key_check")).toBeUndefined();
  });

  it("Notiz auf beiden Geräten geändert: nichts geht verloren", async () => {
    const { a, b, note } = await twoDevices();
    await tick();
    notes.save(a, note.id, doc("Fassung iPad"), "Fassung iPad");
    await tick();
    notes.save(b, note.id, doc("Fassung Laptop"), "Fassung Laptop");
    // Ohne vorhandene Versionen: echter Konflikt
    a.run("DELETE FROM note_versions");
    b.run("DELETE FROM note_versions");
    const rep = mergeDatabases(a, b);
    expect(rep.conflicts).toBe(1);
    expect(a.value("SELECT plain_text FROM notes WHERE node_id = ?1", [note.id])).toBe("Fassung Laptop");
    const v = a.all<{ plain_text: string; reason: string }>("SELECT plain_text, reason FROM note_versions WHERE node_id = ?1", [note.id]);
    expect(v.some((x) => x.plain_text === "Fassung iPad" && x.reason.startsWith("Abgleich"))).toBe(true);
  });

  it("Papierkorb und Handschrift werden übertragen, Einstellungen nicht", async () => {
    const { a, b, course } = await twoDevices();
    const sha = "c".repeat(64);
    for (const d of [a, b]) d.run("INSERT OR IGNORE INTO blobs (sha256, size, mime, created_at) VALUES (?1, 3, 'application/pdf', ?2)", [sha, now()]);
    const docId = newId();
    b.run("INSERT INTO documents (id, blob_sha, title, original_name, ext, created_at, updated_at) VALUES (?1, ?2, 'Folien', 'f.pdf', 'pdf', ?3, ?3)", [docId, sha, now()]);
    const ink = annotations.create(b, { document_id: docId, page: 1, kind: "ink", ink: "v1|2000|2828\npen|#1d2433|5|1,1,50;9,9,50" });
    const newBlob = "d".repeat(64);
    b.run("INSERT INTO blobs (sha256, size, mime, created_at) VALUES (?1, 3, 'image/png', ?2)", [newBlob, now()]);
    await tick();
    b.run("UPDATE nodes SET deleted_at = ?2 WHERE id = ?1", [course.id, now()]);
    b.run("INSERT INTO settings (key, value) VALUES ('ui.theme', '\"dark\"')");
    const rep = mergeDatabases(a, b);
    expect(rep.blobs).toEqual([newBlob]);
    expect(annotations.list(a, docId)[0]?.id).toBe(ink.id);
    expect(a.value("SELECT deleted_at FROM nodes WHERE id = ?1", [course.id])).toBeTruthy();
    expect(a.value("SELECT value FROM settings WHERE key = 'ui.theme'")).toBeUndefined();
  });

  it("verschiedene Schemastände werden abgelehnt", async () => {
    const { a, b } = await twoDevices();
    b.exec("PRAGMA user_version = 99");
    expect(() => mergeDatabases(a, b)).toThrow(/anderen Datenstand/);
  });
});
