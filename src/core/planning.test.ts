// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { Db } from "./db";
import * as annotations from "./repo/annotations";
import * as areas from "./repo/areas";
import * as nodes from "./repo/nodes";
import * as planning from "./repo/planning";
import { rebuild, search } from "./search";
import { openTestDb } from "./testing";
import { newId, now } from "./util";

async function setup() {
  const db = await openTestDb();
  const jura = areas.create(db, "Rechtswissenschaften", "#1f3f8f").id;
  const wiwi = areas.create(db, "WiWiZ", "#9a5b13").id;
  return { db, jura, wiwi };
}

/** Minimales Dokument ohne `documents.ts` (Blob- und Dokumentzeile). */
function insertDoc(db: Db, title: string): string {
  const sha = "a".repeat(64);
  const id = newId();
  const ts = now();
  db.run("INSERT OR IGNORE INTO blobs (sha256, size, mime, created_at) VALUES (?1, 13, 'application/pdf', ?2)", [sha, ts]);
  db.run(
    `INSERT INTO documents (id, blob_sha, title, original_name, ext, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'pdf', ?5, ?5)`,
    [id, sha, title, `${title}.pdf`, ts],
  );
  return id;
}

describe("Planung: Aufgaben und Prüfungen", () => {
  it("tasks_and_exams", async () => {
    const f = await setup();
    const course = nodes.create(f.db, { area_id: f.jura, parent_id: null, kind: "course", title: "BGB AT" });
    const t = planning.taskCreate(f.db, {
      area_id: null,
      node_id: course.id,
      kind: "frage",
      title: "Was ist ein Erklärungsirrtum?",
      notes: "",
      due_date: "2026-11-02",
    });
    expect(t.area_id).toBe(f.jura); // Bereich aus der Veranstaltung übernommen
    expect(() => planning.taskCreate(f.db, { title: "x", due_date: "31.12.2026" })).toThrow("Bitte ein gültiges Datum angeben.");
    planning.taskUpdate(f.db, t.id, { done: true });
    expect(planning.taskList(f.db, {})).toHaveLength(0);
    expect(planning.taskList(f.db, { include_done: true })).toHaveLength(1);

    const e = planning.examSave(f.db, null, { node_id: course.id, title: "Klausur BGB AT", date: "2027-02-10", time: "10:00" });
    planning.examSave(f.db, null, { area_id: f.jura, title: "Alte Klausur", date: "2025-02-10" });
    const upcoming = planning.examList(f.db, f.jura, "2026-10-14");
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]!.id).toBe(e.id);
    expect(() => planning.examSave(f.db, null, { title: "ohne Datum", date: "" })).toThrow("Bitte ein Datum angeben.");
    planning.trash(f.db, "exam", e.id);
    expect(planning.examList(f.db, null, null).every((x) => x.id !== e.id)).toBe(true);
  });

  it("prüft Daten, Arten und Patches wie der Rust-Kern", async () => {
    const { db } = await setup();
    expect(planning.cleanDate("2024-02-29")).toBe("2024-02-29");
    expect(planning.cleanDate("  ")).toBeNull();
    expect(planning.cleanDate(null)).toBeNull();
    for (const bad of ["2023-02-29", "2026-13-01", "2026-1-01", "2026-04-31", "+999-01-01"]) {
      expect(() => planning.cleanDate(bad)).toThrow("Bitte ein gültiges Datum angeben.");
    }
    expect(() => planning.taskCreate(db, { title: "x", kind: "quatsch" as never })).toThrow("Unbekannte Art.");
    expect(() => planning.taskCreate(db, { title: "   " })).toThrow("Der Titel darf nicht leer sein.");

    const t = planning.taskCreate(db, { title: "Lesen", notes: "  Zeile 1\nZeile\u0007 2  ", due_date: "2026-11-01" });
    expect(t.kind).toBe("aufgabe");
    expect(t.notes).toBe("Zeile 1\nZeile 2");
    // fehlend = unverändert, null = leeren
    expect(planning.taskUpdate(db, t.id, { title: "Lesen!" }).due_date).toBe("2026-11-01");
    expect(planning.taskUpdate(db, t.id, { due_date: null }).due_date).toBeNull();
    const done = planning.taskUpdate(db, t.id, { done: true });
    expect(done.done_at).not.toBeNull();
    expect(planning.taskUpdate(db, t.id, { done: true }).done_at).toBe(done.done_at);
    expect(planning.taskUpdate(db, t.id, { done: false }).done_at).toBeNull();
    expect(() => planning.taskUpdate(db, newId(), {})).toThrow("Aufgabe nicht gefunden.");
    expect(() => planning.taskUpdate(db, t.id, { node_id: newId() })).toThrow(/nicht gefunden/);

    // Papierkorb
    expect(() => planning.trash(db, "card", t.id)).toThrow("Unbekannter Eintrag.");
    expect(() => planning.purge(db, "task", t.id)).toThrow("Nur Einträge im Papierkorb können endgültig gelöscht werden.");
    planning.trash(db, "task", t.id);
    expect(planning.taskList(db, { include_done: true })).toHaveLength(0);
    planning.restore(db, "task", t.id);
    expect(planning.taskList(db, { include_done: true })).toHaveLength(1);
    planning.trash(db, "task", t.id);
    planning.purge(db, "task", t.id);
    expect(() => planning.taskGet(db, t.id)).toThrow("Aufgabe nicht gefunden.");
    expect(db.value("SELECT COUNT(*) FROM search_index WHERE entity_id = ?1", [t.id])).toBe(0);

    // Prüfung bearbeiten
    const e = planning.examSave(db, null, { title: "Klausur", date: "2027-01-01", place: "Hörsaal 1", kind: "schriftlich" });
    const e2 = planning.examSave(db, e.id, { title: "Klausur neu", date: "2027-01-02" });
    expect(e2.id).toBe(e.id);
    expect(e2.place).toBe("");
    expect(() => planning.examSave(db, newId(), { title: "x", date: "2027-01-01" })).toThrow("Prüfungstermin nicht gefunden.");
  });

  it("rebuild_index_covers_all_entities (Aufgaben)", async () => {
    const { db } = await setup();
    planning.taskCreate(db, { title: "Sachenrecht wiederholen" });
    planning.examSave(db, null, { title: "Klausur", date: "2027-01-01", place: "Audimax" });
    db.run("DELETE FROM search_index");
    rebuild(db);
    expect(search(db, "Sachenrecht", null, 5)).toHaveLength(1);
    expect(search(db, "Audimax", null, 5)).toHaveLength(1);
  });
});

describe("PDF-Markierungen", () => {
  it("pdf_annotations_and_bookmarks", async () => {
    const f = await setup();
    const docId = insertDoc(f.db, "Skript");
    const r = { x: 0.1, y: 0.2, w: 0.5, h: 0.03 };
    const h = annotations.create(f.db, {
      document_id: docId,
      page: 3,
      kind: "highlight",
      color: "gruen",
      rects: [r],
      quote: "Trennungsprinzip",
      comment: "Klausurrelevant",
    });
    expect(h.rects).toEqual([r]);
    expect(() =>
      annotations.create(f.db, { document_id: docId, page: 1, kind: "highlight", rects: [{ x: 5, y: 0, w: 0.1, h: 0.1 }] }),
    ).toThrow("Ungültige Position der Markierung.");
    expect(() =>
      annotations.create(f.db, { document_id: docId, page: 1, kind: "highlight", color: "pink; x" as never, rects: [r] }),
    ).toThrow("Unbekannte Farbe.");
    const b1 = annotations.create(f.db, { document_id: docId, page: 5, kind: "bookmark", rects: [], comment: "Kapitel 2" });
    const b2 = annotations.create(f.db, { document_id: docId, page: 5, kind: "bookmark", rects: [] });
    expect(b1.id).toBe(b2.id); // ein Lesezeichen je Seite

    // Nicht zugeordnete Dokumente (und ihre Markierungen) erscheinen in jedem Bereich
    expect(search(f.db, "klausurrelevant", f.wiwi, 5)).toHaveLength(1);
    const course = nodes.create(f.db, { area_id: f.jura, parent_id: null, kind: "course", title: "Sachenrecht" });
    f.db.run("INSERT INTO placements (document_id, node_id, created_at) VALUES (?1, ?2, ?3)", [docId, course.id, now()]);
    expect(search(f.db, "klausurrelevant", f.wiwi, 5)).toHaveLength(0); // zugeordnet: nur im eigenen Bereich
    expect(search(f.db, "klausurrelevant", f.jura, 5)).toHaveLength(1);
    const hit = search(f.db, "klausurrelevant", null, 5)[0]!;
    expect(hit.entity_type).toBe("annotation");
    expect(hit.page).toBe(3);
    expect(hit.target_id).toBe(docId);
    annotations.update(f.db, h.id, { comment: "Nicht mehr" });
    expect(search(f.db, "klausurrelevant", null, 5)).toHaveLength(0);
    expect(annotations.list(f.db, docId)).toHaveLength(2);
    annotations.remove(f.db, h.id);
    expect(annotations.list(f.db, docId)).toHaveLength(1);
  });

  it("prüft Eingaben wie der Rust-Kern", async () => {
    const { db } = await setup();
    const docId = insertDoc(db, "Skript");
    const r = { x: 0, y: 0, w: 1, h: 1 };
    expect(() => annotations.create(db, { document_id: "x", page: 1, kind: "highlight", rects: [r] })).toThrow("Ungültige Kennung.");
    expect(() => annotations.create(db, { document_id: docId, page: 1, kind: "x" as never, rects: [r] })).toThrow(
      "Unbekannte Art der Markierung.",
    );
    expect(() => annotations.create(db, { document_id: docId, page: 0, kind: "highlight", rects: [r] })).toThrow("Ungültige Seitenzahl.");
    expect(() => annotations.create(db, { document_id: docId, page: 1, kind: "highlight", rects: [] })).toThrow(
      "Die Markierung hat keinen Bereich.",
    );
    expect(() =>
      annotations.create(db, { document_id: docId, page: 1, kind: "highlight", rects: Array.from({ length: 501 }, () => r) }),
    ).toThrow("Zu viele Bereiche in einer Markierung.");
    expect(() =>
      annotations.create(db, { document_id: docId, page: 1, kind: "highlight", rects: [{ x: 0, y: 0, w: NaN, h: 0 }] }),
    ).toThrow("Ungültige Position der Markierung.");
    expect(() => annotations.create(db, { document_id: newId(), page: 1, kind: "highlight", rects: [r] })).toThrow(
      "Dokument nicht gefunden.",
    );
    const a = annotations.create(db, { document_id: docId, page: 2, kind: "highlight", rects: [r], quote: "Zitat" });
    expect(a.color).toBe("gelb");
    expect(() => annotations.update(db, a.id, { color: "orange" as never })).toThrow("Unbekannte Farbe.");
    expect(annotations.update(db, a.id, { color: "lila" }).color).toBe("lila");
    expect(() => annotations.get(db, newId())).toThrow("Markierung nicht gefunden.");

    // Neuaufbau des Index
    db.run("DELETE FROM search_index");
    annotations.reindexAll(db);
    expect(search(db, "Zitat", null, 5)).toHaveLength(1);
  });
});
