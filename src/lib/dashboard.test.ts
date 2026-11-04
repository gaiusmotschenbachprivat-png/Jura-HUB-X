import { describe, expect, it } from "vitest";

import type { StudyNode } from "../api/types";
import { dashboardConfig, isReviewed, lectureNow, lecturesDoneToday, missingExplanations, moveWidget, nextOccurrence, openQuestionsOf, streak, whenLabel } from "./dashboard";
import type { PMNode } from "./pm";
import type { Slot } from "./timetable";

const course = (id: string) => ({ id, title: id, kind: "course" }) as StudyNode;
// Mittwoch, 4.11.2026
const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m);
const slot = (id: string, day: number, start: number, end: number): Slot => ({ course: course(id), day, start, end, room: "" });
const SLOTS = [slot("StR", 3, 10 * 60 + 15, 11 * 60 + 45), slot("BGB", 3, 14 * 60, 15 * 60 + 30), slot("ÖR", 5, 8 * 60 + 30, 10 * 60)];
const P = (t: string): PMNode => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const H = (t: string, level = 2): PMNode => ({ type: "heading", attrs: { level }, content: [{ type: "text", text: t }] });
const tasks = (...items: [string, boolean][]): PMNode => ({ type: "taskList", content: items.map(([t, checked]) => ({ type: "taskItem", attrs: { checked }, content: [P(t)] })) });

describe("Übersicht: Jetzt", () => {
  it("Vorlesung bald, läuft, keine", () => {
    expect(lectureNow(SLOTS, at(9, 30))).toMatchObject({ phase: "bald", minutes: 45, slot: { course: { id: "StR" } } });
    expect(lectureNow(SLOTS, at(10, 5))).toMatchObject({ phase: "bald", minutes: 10 });
    expect(lectureNow(SLOTS, at(11, 0))).toMatchObject({ phase: "laeuft", minutes: 45 });
    expect(lectureNow(SLOTS, at(12, 0))).toBeNull();
    expect(lecturesDoneToday(SLOTS, at(16, 0)).map((s) => s.course.id)).toEqual(["StR", "BGB"]);
  });
  it("nächster Termin und Beschriftung", () => {
    const n = nextOccurrence(SLOTS, "ÖR", at(12));
    expect(n?.date).toEqual(new Date(2026, 10, 6, 8, 30));
    expect(whenLabel(n!.date, at(12))).toBe("Fr 8:30");
    expect(whenLabel(nextOccurrence(SLOTS, "BGB", at(12))!.date, at(12))).toBe("heute 14:00");
    expect(whenLabel(nextOccurrence(SLOTS, "StR", at(12))!.date, at(12))).toBe("Mi 10:15");
  });
});

describe("Übersicht: Offene Enden", () => {
  it("offene Fragen nur unter „Offene Fragen“, nicht abgehakt, ohne Platzhalter", () => {
    const doc: PMNode = { type: "doc", content: [H("Mitschrift"), tasks(["keine Frage", false]), H("Offene Fragen"), tasks(["Gilt § 142 auch für Vollmacht?", false], ["erledigt", true], ["…", false]), H("Zum Wiederholen"), tasks(["nicht gemeint", false])] };
    expect(openQuestionsOf(doc)).toEqual(["Gilt § 142 auch für Vollmacht?"]);
  });
  it("fehlende Erklärungen und Nachbereitung", () => {
    const doc: PMNode = { type: "doc", content: [P("x"), { type: "erklaerungen", content: [P("ex tunc – rückwirkend"), { type: "paragraph", content: [{ type: "text", text: "Synallagma", marks: [{ type: "bold" }] }, { type: "text", text: " – " }] }] }] };
    expect(missingExplanations(doc)).toEqual(["Synallagma"]);
    const note = { id: "n1", title: "3. Vorlesung", parent_id: "c", kind: "note" } as StudyNode;
    expect(isReviewed(note, doc, [], new Set())).toBe(false);
    expect(isReviewed(note, doc, [], new Set(["n1"]))).toBe(true);
    expect(isReviewed(note, { type: "doc", content: [H("Lernskript (KI, ungeprüft)")] }, [], new Set())).toBe(true);
    expect(isReviewed(note, doc, [{ id: "n2", kind: "note", parent_id: "c", title: "Lernskript: 3. Vorlesung" } as StudyNode], new Set())).toBe(true);
  });
});

describe("Übersicht: Lernen und Kacheln", () => {
  it("Serie", () => {
    expect(streak([0, 0, 3, 5, 1, 2, 4])).toBe(5);
    expect(streak([0, 0, 3, 5, 1, 2, 0])).toBe(4);
    expect(streak([1, 0, 0, 0, 0, 0, 0])).toBe(0);
  });
  it("Anordnung: unbekannte Werte verworfen, neue Kacheln hinten, verschieben", () => {
    const c = dashboardConfig({ order: ["offen", "jetzt", "quatsch", "offen"], hidden: ["zuletzt", "x"] });
    expect(c.order.slice(0, 3)).toEqual(["offen", "jetzt", "lernen"]);
    expect(c.order).toHaveLength(7);
    expect(c.hidden).toEqual(["zuletzt"]);
    expect(moveWidget(c, "jetzt", -1).order.slice(0, 2)).toEqual(["jetzt", "offen"]);
    expect(moveWidget(c, "offen", -1)).toBe(c);
  });
});
