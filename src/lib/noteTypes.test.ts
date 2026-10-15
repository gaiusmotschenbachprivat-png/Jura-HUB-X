import { describe, expect, it } from "vitest";

import type { StudyNode } from "../api/types";
import { compareNodes, formatDateDe, lectureDoc, lectureTitle, nextLectureNumber, noteTypeOf } from "./noteTypes";
import { plainText } from "./pm";
import { buildTree } from "./tree";

let seq = 0;
const node = (o: Partial<StudyNode>): StudyNode => ({
  id: `n${++seq}`,
  area_id: "a",
  parent_id: "c",
  kind: "note",
  title: "x",
  position: seq * 1024,
  meta: {},
  created_at: `2026-10-0${seq % 9}T10:00:00Z`,
  updated_at: `2026-10-0${seq % 9}T10:00:00Z`,
  archived_at: null,
  deleted_at: null,
  ...o,
});

describe("Schreibarten", () => {
  it("erkennt die Art; ältere Notizen gelten als Notiz, Struktur hat keine", () => {
    expect(noteTypeOf(node({ meta: { noteType: "vorlesung" } }))).toBe("vorlesung");
    expect(noteTypeOf(node({}))).toBe("notiz");
    expect(noteTypeOf(node({ meta: { noteType: "quatsch" } }))).toBe("notiz");
    expect(noteTypeOf(node({ kind: "folder" }))).toBeNull();
  });

  it("Vorlesungsnummer, Titel, Datum, Inhalt", () => {
    const list = [node({ meta: { noteType: "vorlesung", number: 1 } }), node({ meta: { noteType: "vorlesung", number: 4 } }), node({ parent_id: "andere", meta: { noteType: "vorlesung", number: 9 } })];
    expect(nextLectureNumber(list, "c", "a")).toBe(5);
    expect(nextLectureNumber(list, "leer", "a")).toBe(1);
    expect(lectureTitle(3, " Anfechtung ")).toBe("3. Vorlesung: Anfechtung");
    expect(lectureTitle(null, "")).toBe("Vorlesung");
    expect(formatDateDe("2026-10-15")).toBe("15.10.2026");
    expect(formatDateDe("2026-10-15", true)).toBe("15.10.");
    const text = plainText(lectureDoc({ title: "3. Vorlesung", date: "2026-10-15", lecturer: "Prof. X", course: "BGB AT" }));
    expect(text).toContain("Datum: 15.10.2026");
    expect(text).toContain("Dozent/in: Prof. X");
    expect(text).toContain("Mitschrift");
  });

  it("automatische Sortierung: Struktur zuerst, dann Arten, Vorlesungen nach Datum", () => {
    const items = [
      node({ title: "Fall 1", meta: { noteType: "fall" } }),
      node({ title: "V2", meta: { noteType: "vorlesung", date: "2026-10-22", number: 2 } }),
      node({ title: "Ordner", kind: "folder" }),
      node({ title: "Freie Notiz" }),
      node({ title: "V1", meta: { noteType: "vorlesung", date: "2026-10-15", number: 1 } }),
      node({ title: "Zusammenfassung", meta: { noteType: "zusammenfassung" } }),
    ];
    expect([...items].sort(compareNodes("auto")).map((n) => n.title)).toEqual(["Ordner", "V1", "V2", "Zusammenfassung", "Fall 1", "Freie Notiz"]);
    expect([...items].sort(compareNodes("name")).map((n) => n.title)[0]).toBe("Fall 1");
    expect([...items].sort(compareNodes("manual")).map((n) => n.title)[0]).toBe("Fall 1");
  });

  it("Baum verwendet die gewählte Sortierung", () => {
    const course = node({ id: "c", parent_id: null, kind: "course", title: "BGB AT" });
    const a = node({ title: "B-Notiz" });
    const b = node({ title: "A-Vorlesung", meta: { noteType: "vorlesung", date: "2026-10-01" } });
    expect(buildTree([course, a, b], { sort: "auto" })[0]!.children.map((c) => c.node.title)).toEqual(["A-Vorlesung", "B-Notiz"]);
    expect(buildTree([course, a, b], { sort: "manual" })[0]!.children.map((c) => c.node.title)).toEqual(["B-Notiz", "A-Vorlesung"]);
  });
});
