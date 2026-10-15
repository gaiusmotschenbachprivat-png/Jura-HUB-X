/**
 * Stundenplan aus den Angaben der Veranstaltungen (Wochentag, Uhrzeit, Ort)
 * und Lernplan für die Klausurenphase. Reine Funktionen, damit testbar.
 */
import type { Exam, StudyNode } from "../api/types";
import { compareNodes, noteTypeOf } from "./noteTypes";

export const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const SHORT = ["mo", "di", "mi", "do", "fr", "sa", "so"];

/** „Mo, Do“, „Montag und Mittwoch“, „Mo–Mi“, „dienstags“ → [1, 4] (1 = Montag). */
export function parseWeekdays(text: unknown): number[] {
  if (typeof text !== "string") return [];
  const t = text.toLowerCase();
  const tokens: { day: number; at: number }[] = [];
  const re = /\b(mo|di|mi|do|fr|sa|so)(?:ntag|enstag|ttwoch|nnerstag|eitag|mstag|nnabend|nntag)?s?\b\.?/g;
  for (let m = re.exec(t); m; m = re.exec(t)) tokens.push({ day: SHORT.indexOf(m[1]!) + 1, at: m.index });
  const out = new Set<number>();
  tokens.forEach((tok, i) => {
    out.add(tok.day);
    const next = tokens[i + 1];
    // Bereich „Mo–Mi“ / „Mo bis Mi“
    if (next && /^\s*(?:[-–]|bis)\s*$/.test(t.slice(tok.at, next.at).replace(/^[a-zäöü.]+/, ""))) {
      for (let d = tok.day + 1; d < next.day; d++) out.add(d);
    }
  });
  return [...out].sort((a, b) => a - b);
}

/** „10:15–11:45“, „10.15 - 11.45 Uhr“, „10–12“, „10 bis 12 Uhr“, „14:00“ → Minuten seit Mitternacht. */
export function parseTimeRange(text: unknown): { start: number; end: number } | null {
  if (typeof text !== "string") return null;
  const re = /(\d{1,2})(?:[:.](\d{2}))?/g;
  const nums: number[] = [];
  for (let m = re.exec(text); m && nums.length < 2; m = re.exec(text)) {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h > 23 || min > 59) continue;
    nums.push(h * 60 + min);
  }
  if (!nums.length) return null;
  const start = nums[0]!;
  const end = nums[1] !== undefined && nums[1] > start ? nums[1] : start + 90;
  return { start, end };
}

export const fmtTime = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export interface Slot {
  course: StudyNode;
  day: number;
  start: number;
  end: number;
  room: string;
}

/** Alle Termine der (nicht archivierten) Veranstaltungen. */
export function courseSlots(nodes: StudyNode[]): { slots: Slot[]; unscheduled: StudyNode[] } {
  const slots: Slot[] = [];
  const unscheduled: StudyNode[] = [];
  for (const n of nodes) {
    if (n.kind !== "course" || n.archived_at || n.deleted_at) continue;
    const days = parseWeekdays(n.meta?.weekday);
    const time = parseTimeRange(n.meta?.time);
    if (!days.length || !time) {
      unscheduled.push(n);
      continue;
    }
    for (const day of days) slots.push({ course: n, day, ...time, room: typeof n.meta?.room === "string" ? n.meta.room : "" });
  }
  slots.sort((a, b) => a.day - b.day || a.start - b.start);
  return { slots, unscheduled };
}

/** Wochentag eines ISO-Datums (1 = Montag). */
export function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(y!, m! - 1, d!).getDay();
  return wd === 0 ? 7 : wd;
}

/** Vorlesung eines Tages in einer Veranstaltung (auch in Unterordnern), falls schon angelegt. */
export function lectureOn(nodes: StudyNode[], courseId: string, dateIso: string): StudyNode | undefined {
  const inside = (n: StudyNode): boolean => {
    let p = n.parent_id;
    for (let i = 0; p && i < 50; i++) {
      if (p === courseId) return true;
      p = nodes.find((x) => x.id === p)?.parent_id ?? null;
    }
    return false;
  };
  return nodes.find((n) => !n.deleted_at && noteTypeOf(n) === "vorlesung" && n.meta?.date === dateIso && inside(n));
}

// ---- Klausurenphase: Lernplan ----

export const PLAN_MARK = (examId: string) => `[Lernplan ${examId}]`;

export interface PlannedTask {
  title: string;
  due_date: string;
  node_id: string | null;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Verteilt die Inhalte unter der Klausur-Veranstaltung (Vorlesungen,
 * Zusammenfassungen, Fälle …) gleichmäßig auf die Lerntage bis drei Tage vor
 * der Klausur (sonntags frei). Danach Probeklausur und Schlusswiederholung.
 */
export function buildStudyPlan(o: { exam: Exam; nodes: StudyNode[]; today: string; restDay?: number }): PlannedTask[] {
  const rest = o.restDay ?? 7;
  const root = o.exam.node_id;
  const under = (n: StudyNode) => {
    let p = n.parent_id;
    for (let i = 0; p && i < 50; i++) {
      if (p === root) return true;
      p = o.nodes.find((x) => x.id === p)?.parent_id ?? null;
    }
    return false;
  };
  const items = root ? o.nodes.filter((n) => n.kind === "note" && !n.deleted_at && !n.archived_at && under(n)).sort(compareNodes("auto")) : [];
  const last = addDays(o.exam.date, -3);
  const days: string[] = [];
  for (let d = o.today; d <= last && days.length < 400; d = addDays(d, 1)) if (isoWeekday(d) !== rest) days.push(d);
  const out: PlannedTask[] = [];
  if (items.length && days.length) {
    items.forEach((n, i) => {
      // gleichmäßig verteilt, frühere Inhalte zuerst
      const day = days[Math.min(days.length - 1, Math.floor((i * days.length) / items.length))]!;
      const verb = noteTypeOf(n) === "fall" || noteTypeOf(n) === "uebung" ? "Fall erneut lösen" : "Wiederholen";
      out.push({ title: `${verb}: ${n.title}`, due_date: day, node_id: n.id });
    });
  }
  const before = (k: number) => (addDays(o.exam.date, -k) >= o.today ? addDays(o.exam.date, -k) : o.today);
  out.push({ title: `Probeklausur unter Zeitdruck schreiben (${o.exam.title})`, due_date: before(2), node_id: root });
  out.push({ title: `Schemata, Definitionen und Karteikarten wiederholen (${o.exam.title})`, due_date: before(1), node_id: root });
  return out;
}
