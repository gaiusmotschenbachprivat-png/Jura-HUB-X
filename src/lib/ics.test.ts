import { describe, expect, it } from "vitest";

import type { StudyNode } from "../api/types";
import { expandEvents, parseIcs } from "./ics";
import { courseIdentity, courseMeta, groupCourses, planImport, semesterName, splitTitle } from "./stundenplanImport";
import { slotsOnDate } from "./timetable";

// Erfundene Beispieldaten im üblichen Aufbau eines Uni-Kalender-Abos
const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:a1",
  "SUMMARY:Strafrecht Allgemeiner Teil (Vorlesung)",
  "LOCATION:H 24 (RW I)",
  "DTSTART;TZID=Europe/Berlin:20261103T101500",
  "DTEND;TZID=Europe/Berlin:20261103T114500",
  "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261203T235959Z",
  "EXDATE;TZID=Europe/Berlin:20261112T101500",
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:a1",
  "RECURRENCE-ID;TZID=Europe/Berlin:20261117T101500",
  "SUMMARY:Strafrecht Allgemeiner Teil (Vorlesung)",
  "LOCATION:H 15",
  "DTSTART;TZID=Europe/Berlin:20261117T121500",
  "DTEND;TZID=Europe/Berlin:20261117T134500",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:b1",
  "SUMMARY:AG Strafrecht",
  "LOCATION:S 64",
  "DTSTART:20261104T130000",
  "DTEND:20261104T143000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:b2",
  "SUMMARY:AG Strafrecht",
  "LOCATION:S 64",
  "STATUS:CANCELLED",
  "DTSTART:20261111T130000",
  "DTEND:20261111T143000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:c1",
  "SUMMARY:Vorlesungsfrei\\, Buß- und Bettag",
  "DTSTART;VALUE=DATE:20261118",
  "DTEND;VALUE=DATE:20261119",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("Kalenderdatei", () => {
  it("liest Termine, Wiederholung, Ausnahme, verschobenen und abgesagten Termin", () => {
    const ev = parseIcs(ICS);
    expect(ev).toHaveLength(5);
    expect(ev[4]!.summary).toBe("Vorlesungsfrei, Buß- und Bettag");
    const occ = expandEvents(ev, new Date(2026, 9, 1), new Date(2027, 2, 31));
    const str = occ.filter((o) => o.uid === "a1");
    // Di/Do 3.11.–3.12.: 10 Termine, 12.11. fällt aus, 17.11. verschoben (eigener Eintrag)
    expect(str.map((o) => `${o.start.getDate()}.${o.start.getMonth() + 1}. ${o.start.getHours()}:${o.start.getMinutes()}`)).toEqual([
      "3.11. 10:15",
      "5.11. 10:15",
      "10.11. 10:15",
      "17.11. 12:15",
      "19.11. 10:15",
      "24.11. 10:15",
      "26.11. 10:15",
      "1.12. 10:15",
      "3.12. 10:15",
    ]);
    expect(str.find((o) => o.start.getDate() === 17)!.location).toBe("H 15");
    expect(occ.find((o) => o.uid === "b2")!.cancelled).toBe(true);
  });

  it("Titel: Nummer und Typ abtrennen", () => {
    expect(splitTitle("12345 VL Strafrecht AT")).toEqual({ base: "Strafrecht AT", type: "Vorlesung" });
    expect(splitTitle("Strafrecht Allgemeiner Teil (Vorlesung)")).toEqual({ base: "Strafrecht Allgemeiner Teil", type: "Vorlesung" });
    expect(splitTitle("Staatsrecht I - Übung")).toEqual({ base: "Staatsrecht I", type: "Übung" });
    expect(splitTitle("BGB AT (12.345)")).toEqual({ base: "BGB AT", type: null });
    expect(courseIdentity("AG Strafrecht").title).toBe("Strafrecht – AG");
    expect(courseIdentity("Strafrecht (VL)").key).toBe(courseIdentity("Vorlesung: Strafrecht").key);
  });

  it("Veranstaltungen mit Wochenmuster und Einzelterminen; Feiertage nicht", () => {
    const courses = groupCourses(expandEvents(parseIcs(ICS), new Date(2026, 9, 1), new Date(2027, 2, 31)));
    expect(courses.map((c) => c.title)).toEqual(["Strafrecht Allgemeiner Teil", "Strafrecht – AG"]);
    const str = courses[0]!;
    expect(str).toMatchObject({ weekdays: [2, 4], start: 615, end: 705, room: "H 24 (RW I)" });
    expect(str.termine).toHaveLength(9);
    expect(courseMeta(str, { lecturer: "Prof. X" })).toMatchObject({ weekday: "Di, Do", time: "10:15–11:45", room: "H 24 (RW I)", lecturer: "Prof. X" });
  });

  it("heute zählen die Einzeltermine: verschoben, abgesagt, Raum", () => {
    const courses = groupCourses(expandEvents(parseIcs(ICS), new Date(2026, 9, 1), new Date(2027, 2, 31)));
    const node = (c: (typeof courses)[number], id: string) => ({ id, kind: "course", title: c.title, area_id: "a", meta: courseMeta(c) }) as unknown as StudyNode;
    const nodes = [node(courses[0]!, "s"), node(courses[1]!, "ag")];
    expect(slotsOnDate(nodes, "2026-11-17").map((s) => [s.course.id, s.start, s.room])).toEqual([["s", 735, "H 15"]]);
    expect(slotsOnDate(nodes, "2026-11-12")).toEqual([]); // ausgefallen (EXDATE)
    expect(slotsOnDate(nodes, "2026-11-11")).toEqual([]); // AG abgesagt
    expect(slotsOnDate(nodes, "2026-11-04").map((s) => s.course.id)).toEqual(["ag"]);
  });

  it("vorhandene Veranstaltung wird erkannt, Semestername", () => {
    const courses = groupCourses(expandEvents(parseIcs(ICS), new Date(2026, 9, 1), new Date(2027, 2, 31)));
    const existing = { id: "x", kind: "course", title: "Strafrecht Allgemeiner Teil", area_id: "a", meta: {} } as unknown as StudyNode;
    const plan = planImport(courses, [existing], "a");
    expect(plan.update.map((u) => u.node.id)).toEqual(["x"]);
    expect(plan.create.map((c) => c.title)).toEqual(["Strafrecht – AG"]);
    expect(semesterName(new Date(2026, 10, 4))).toBe("Wintersemester 2026/27");
    expect(semesterName(new Date(2027, 1, 4))).toBe("Wintersemester 2026/27");
    expect(semesterName(new Date(2027, 4, 4))).toBe("Sommersemester 2027");
  });
});
