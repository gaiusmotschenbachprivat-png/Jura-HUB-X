import { describe, expect, it } from "vitest";

import type { Exam, StudyNode } from "../api/types";
import { decodeDrawing, encodeDrawing, hitStroke } from "./drawing";
import { buildStudyPlan, courseSlots, isoWeekday, lectureOn, parseTimeRange, parseWeekdays } from "./timetable";

let seq = 0;
const node = (o: Partial<StudyNode>): StudyNode => ({
  id: `n${++seq}`,
  area_id: "a",
  parent_id: null,
  kind: "note",
  title: "x",
  position: seq,
  meta: {},
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  archived_at: null,
  deleted_at: null,
  ...o,
});

describe("Stundenplan", () => {
  it("Wochentage erkennen", () => {
    expect(parseWeekdays("Montag")).toEqual([1]);
    expect(parseWeekdays("Mo, Do")).toEqual([1, 4]);
    expect(parseWeekdays("dienstags und freitags")).toEqual([2, 5]);
    expect(parseWeekdays("Mo–Mi")).toEqual([1, 2, 3]);
    expect(parseWeekdays("Mittwoch bis Freitag")).toEqual([3, 4, 5]);
    expect(parseWeekdays("morgens")).toEqual([]);
    expect(parseWeekdays(undefined)).toEqual([]);
  });
  it("Uhrzeiten erkennen", () => {
    expect(parseTimeRange("10:15–11:45")).toEqual({ start: 615, end: 705 });
    expect(parseTimeRange("10.15 - 11.45 Uhr")).toEqual({ start: 615, end: 705 });
    expect(parseTimeRange("10–12")).toEqual({ start: 600, end: 720 });
    expect(parseTimeRange("14:00")).toEqual({ start: 840, end: 930 });
    expect(parseTimeRange("abends")).toBeNull();
  });
  it("Termine aus Veranstaltungen, heutige Vorlesung finden", () => {
    const bgb = node({ kind: "course", title: "BGB AT", meta: { weekday: "Mo, Do", time: "10–12", room: "H 1" } });
    const ohne = node({ kind: "course", title: "Ohne Zeit" });
    const v = node({ parent_id: bgb.id, meta: { noteType: "vorlesung", date: "2026-10-15" } });
    const { slots, unscheduled } = courseSlots([bgb, ohne, v]);
    expect(slots.map((s) => [s.day, s.start, s.room])).toEqual([
      [1, 600, "H 1"],
      [4, 600, "H 1"],
    ]);
    expect(unscheduled.map((n) => n.title)).toEqual(["Ohne Zeit"]);
    expect(isoWeekday("2026-10-15")).toBe(4);
    expect(lectureOn([bgb, v], bgb.id, "2026-10-15")?.id).toBe(v.id);
    expect(lectureOn([bgb, v], bgb.id, "2026-10-12")).toBeUndefined();
  });
});

describe("Lernplan Klausurenphase", () => {
  it("verteilt Inhalte bis 3 Tage vorher, sonntags frei, Probeklausur und Schlusswiederholung", () => {
    const c = node({ kind: "course", title: "BGB AT" });
    const v1 = node({ parent_id: c.id, title: "1. Vorlesung", meta: { noteType: "vorlesung", date: "2026-10-01", number: 1 } });
    const v2 = node({ parent_id: c.id, title: "2. Vorlesung", meta: { noteType: "vorlesung", date: "2026-10-08", number: 2 } });
    const f = node({ parent_id: c.id, title: "Fall 1", meta: { noteType: "fall" } });
    const exam: Exam = { id: "e", area_id: null, node_id: c.id, title: "Klausur BGB AT", date: "2026-10-30", time: "", place: "", kind: "", notes: "", created_at: "", updated_at: "", deleted_at: null };
    const plan = buildStudyPlan({ exam, nodes: [c, v1, v2, f], today: "2026-10-19" });
    expect(plan.map((p) => p.title)).toEqual([
      "Wiederholen: 1. Vorlesung",
      "Wiederholen: 2. Vorlesung",
      "Fall erneut lösen: Fall 1",
      "Probeklausur unter Zeitdruck schreiben (Klausur BGB AT)",
      "Schemata, Definitionen und Karteikarten wiederholen (Klausur BGB AT)",
    ]);
    for (const p of plan.slice(0, 3)) {
      expect(p.due_date >= "2026-10-19" && p.due_date <= "2026-10-27").toBe(true);
      expect(isoWeekday(p.due_date)).not.toBe(7);
    }
    expect(plan[3]!.due_date).toBe("2026-10-28");
    expect(plan[4]!.due_date).toBe("2026-10-29");
    // knapp vor der Klausur: nichts in der Vergangenheit
    const late = buildStudyPlan({ exam, nodes: [c, v1], today: "2026-10-29" });
    expect(late.every((p) => p.due_date >= "2026-10-29")).toBe(true);
  });
});

describe("Zeichnung", () => {
  it("kodiert kompakt und liest zurück; Radierer trifft Striche", () => {
    const d = { v: 1 as const, width: 1000, height: 640, strokes: [{ tool: "pen" as const, color: "#1d2433", size: 3, points: [[10, 10, 0.5], [50.4, 10, 0.8]] as [number, number, number][] }] };
    const s = encodeDrawing(d);
    expect(s).toBe("v1|1000|640\npen|#1d2433|3|10,10,50;50,10,80");
    const back = decodeDrawing(s)!;
    expect(back.strokes[0]!.points[1]).toEqual([50, 10, 0.8]);
    expect(decodeDrawing("kaputt")).toBeNull();
    expect(decodeDrawing("v1|10|10\nevil|<script>|3|1,1,1")!.strokes).toHaveLength(0);
    expect(hitStroke(back.strokes[0]!, 30, 12, 4)).toBe(true);
    expect(hitStroke(back.strokes[0]!, 30, 60, 4)).toBe(false);
  });
});
