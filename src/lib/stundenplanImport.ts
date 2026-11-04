/**
 * Uni-Stundenplan (Kalenderdatei/Abo) → Veranstaltungen: Termine mit gleichem
 * Titel bilden eine Veranstaltung. Aus der häufigsten Uhrzeit ergeben sich
 * Wochentag(e), Zeit und Raum für den Stundenplan; alle Einzeltermine
 * (auch verschobene und ausfallende) werden an der Veranstaltung gespeichert
 * und haben für „heute“ Vorrang vor dem Wochenmuster.
 */
import type { StudyNode } from "../api/types";
import type { Occurrence } from "./ics";
import type { CalendarDate } from "./timetable";
import { fmtTime } from "./timetable";

const TYPES: [RegExp, string][] = [
  [/^(?:vl|v|vo|vorl\.?|vorlesung)$/i, "Vorlesung"],
  [/^(?:ü|ue|übung|uebung)$/i, "Übung"],
  [/^(?:ag|arbeitsgemeinschaft)$/i, "AG"],
  [/^(?:se|s|sem\.?|seminar|hauptseminar|proseminar)$/i, "Seminar"],
  [/^(?:tut|tutorium)$/i, "Tutorium"],
  [/^(?:rep|repetitorium)$/i, "Repetitorium"],
  [/^(?:ko|koll\.?|kolloquium)$/i, "Kolloquium"],
  [/^(?:kl|klausur|prüfung|pruefung)$/i, "Klausur"],
];
const typeOf = (w: string) => TYPES.find(([re]) => re.test(w.trim()))?.[1] ?? null;

/** Titel ohne Lehrveranstaltungsnummer und Typ, dazu der Typ (Vorlesung, Übung …). */
export function splitTitle(summary: string): { base: string; type: string | null } {
  let s = summary.replace(/\s+/g, " ").trim();
  let type: string | null = null;
  // „12345 …“, „[12345] …“, „(12345) …“
  s = s.replace(/^[[(]?\d{3,}[\])]?[\s:–-]+/, "");
  // Typ vorn: „VL Strafrecht“, „Vorlesung: Strafrecht“
  const front = /^([A-Za-zÄÖÜäöü.]+)[\s:–-]+(.+)$/.exec(s);
  if (front && typeOf(front[1]!)) {
    type = typeOf(front[1]!);
    s = front[2]!;
  }
  // Typ hinten: „Strafrecht (Vorlesung)“, „Strafrecht - Übung“, „Strafrecht, VL“
  const back = /^(.+?)\s*(?:\(([^()]+)\)|[–,-]\s*([A-Za-zÄÖÜäöü.]+))$/.exec(s);
  if (back) {
    const t = typeOf((back[2] ?? back[3] ?? "").trim());
    if (t) {
      type = type ?? t;
      s = back[1]!;
    }
  }
  // Nummern in Klammern am Ende entfernen
  s = s.replace(/\s*\(\s*[\d.\s/-]+\)\s*$/, "").trim();
  return { base: s || summary.trim(), type };
}

/** Anzeigename und Schlüssel (gleiche Veranstaltung trotz Schreibvarianten). */
export function courseIdentity(summary: string): { key: string; title: string } {
  const { base, type } = splitTitle(summary);
  const t = type && type !== "Vorlesung" ? type : null;
  const title = t ? `${base} – ${t}` : base;
  const key = `${base.toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim()}|${(t ?? "").toLowerCase()}`;
  return { key, title };
}

export interface ImportCourse {
  key: string;
  title: string;
  /** Wochentage (1 = Montag) der häufigsten Uhrzeit */
  weekdays: number[];
  start: number;
  end: number;
  room: string;
  termine: CalendarDate[];
}

const SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const weekdayText = (days: number[]) => days.map((d) => SHORT[d - 1]).join(", ");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const wd = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay());

/** Termine nach Veranstaltung gruppieren und das Wochenmuster ableiten. */
export function groupCourses(occ: Occurrence[]): ImportCourse[] {
  const groups = new Map<string, { title: string; items: Occurrence[] }>();
  for (const o of occ) {
    const dur = (o.end.getTime() - o.start.getTime()) / 60000;
    // ganztägige oder sehr lange Einträge (Feiertage, Fristen) gehören nicht in den Stundenplan
    if (o.allDay || dur <= 0 || dur > 6 * 60 || !o.summary) continue;
    const { key, title } = courseIdentity(o.summary);
    const g = groups.get(key) ?? { title, items: [] };
    g.items.push(o);
    groups.set(key, g);
  }
  const out: ImportCourse[] = [];
  for (const [key, g] of groups) {
    const active = g.items.filter((o) => !o.cancelled);
    const basis = active.length ? active : g.items;
    // häufigste Uhrzeit
    const times = new Map<string, number>();
    for (const o of basis) {
      const k = `${o.start.getHours() * 60 + o.start.getMinutes()}-${o.end.getHours() * 60 + o.end.getMinutes()}`;
      times.set(k, (times.get(k) ?? 0) + 1);
    }
    const [top] = [...times.entries()].sort((a, b) => b[1] - a[1]);
    const [start, end] = top![0].split("-").map(Number) as [number, number];
    const atTop = basis.filter((o) => o.start.getHours() * 60 + o.start.getMinutes() === start);
    // Wochentage, die mit dieser Uhrzeit mindestens zweimal vorkommen (bei wenigen Terminen: alle)
    const dayCount = new Map<number, number>();
    for (const o of atTop) dayCount.set(wd(o.start), (dayCount.get(wd(o.start)) ?? 0) + 1);
    const weekdays = [...dayCount.entries()].filter(([, n]) => n >= 2 || atTop.length < 4).map(([d]) => d).sort((a, b) => a - b);
    const rooms = new Map<string, number>();
    for (const o of atTop) if (o.location) rooms.set(o.location, (rooms.get(o.location) ?? 0) + 1);
    const room = [...rooms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const termine: CalendarDate[] = g.items
      .map((o) => ({
        date: iso(o.start),
        start: o.start.getHours() * 60 + o.start.getMinutes(),
        end: o.end.getHours() * 60 + o.end.getMinutes(),
        room: o.location,
        ...(o.cancelled ? { cancelled: true } : {}),
      }))
      .slice(0, 300);
    out.push({ key, title: g.title, weekdays, start, end, room, termine });
  }
  return out.sort((a, b) => (a.weekdays[0] ?? 9) - (b.weekdays[0] ?? 9) || a.start - b.start || a.title.localeCompare(b.title, "de"));
}

export interface ImportPlan {
  create: ImportCourse[];
  update: { course: ImportCourse; node: StudyNode; changed: boolean }[];
}

/** Welche Veranstaltungen neu sind und welche schon existieren (über den Kalenderschlüssel oder gleichen Titel). */
export function planImport(courses: ImportCourse[], nodes: StudyNode[], areaId: string): ImportPlan {
  const mine = nodes.filter((n) => n.kind === "course" && !n.deleted_at && n.area_id === areaId);
  const plan: ImportPlan = { create: [], update: [] };
  for (const c of courses) {
    const node = mine.find((n) => n.meta?.calendarKey === c.key) ?? mine.find((n) => n.title.trim().toLowerCase() === c.title.trim().toLowerCase());
    if (!node) plan.create.push(c);
    else plan.update.push({ course: c, node, changed: JSON.stringify(courseMeta(c, node.meta)) !== JSON.stringify(node.meta) });
  }
  return plan;
}

/** Zusatzangaben einer Veranstaltung aus dem Kalender (übrige Angaben wie Dozent/in bleiben). */
export function courseMeta(c: ImportCourse, prev: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...prev,
    weekday: weekdayText(c.weekdays),
    time: `${fmtTime(c.start)}–${fmtTime(c.end)}`,
    room: c.room || prev.room || "",
    termine: c.termine,
    calendarKey: c.key,
  };
}

/** „Wintersemester 2026/27“ bzw. „Sommersemester 2027“ für ein Datum. */
export function semesterName(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (m >= 4 && m <= 9) return `Sommersemester ${y}`;
  const startYear = m >= 10 ? y : y - 1;
  return `Wintersemester ${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}
