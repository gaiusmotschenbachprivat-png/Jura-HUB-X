/**
 * Logik der Übersicht ohne Oberfläche: Was steht jetzt an (Vorlesung bald,
 * läuft, vorbei), nächster Termin einer Veranstaltung, offene Fragen und
 * fehlende Erklärungen in einer Mitschrift, Lernserie, Anordnung der Kacheln.
 */
import type { StudyNode } from "../api/types";
import { explanationsOf } from "./erklaerungen";
import type { PMNode } from "./pm";
import type { Slot } from "./timetable";
import { isoWeekday } from "./timetable";

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export type NowLecture =
  | { phase: "laeuft"; slot: Slot; minutes: number }
  | { phase: "bald"; slot: Slot; minutes: number }
  | null;

/** Vorlesung, die gerade läuft oder in den nächsten 60 Minuten beginnt (heute). */
export function lectureNow(slots: Slot[], now: Date): NowLecture {
  const day = isoWeekday(isoDate(now));
  const m = minutesOf(now);
  const today = slots.filter((s) => s.day === day).sort((a, b) => a.start - b.start);
  const running = today.find((s) => s.start - 15 <= m && m < s.end);
  if (running) return m < running.start ? { phase: "bald", slot: running, minutes: running.start - m } : { phase: "laeuft", slot: running, minutes: m - running.start };
  const soon = today.find((s) => s.start > m && s.start - m <= 60);
  return soon ? { phase: "bald", slot: soon, minutes: soon.start - m } : null;
}

/** Heute schon vorbei. */
export function lecturesDoneToday(slots: Slot[], now: Date): Slot[] {
  const day = isoWeekday(isoDate(now));
  return slots.filter((s) => s.day === day && s.end <= minutesOf(now)).sort((a, b) => a.start - b.start);
}

/** Nächster Termin einer Veranstaltung ab jetzt (innerhalb von 7 Tagen). */
export function nextOccurrence(slots: Slot[], courseId: string, now: Date): { date: Date; slot: Slot } | null {
  const mine = slots.filter((s) => s.course.id === courseId);
  for (let add = 0; add <= 7; add++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
    const day = isoWeekday(isoDate(d));
    const hit = mine.filter((s) => s.day === day && (add > 0 || s.end > minutesOf(now))).sort((a, b) => a.start - b.start)[0];
    if (hit) return { date: new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(hit.start / 60), hit.start % 60), slot: hit };
  }
  return null;
}

/** „heute 10:15“, „morgen 14:00“, „Do 8:30“ */
export function whenLabel(d: Date, now: Date): string {
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  const t = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (days === 0) return `heute ${t}`;
  if (days === 1) return `morgen ${t}`;
  return `${["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getDay()]} ${t}`;
}

const text = (n: PMNode): string => (n.type === "text" ? (n.text ?? "") : (n.content ?? []).map(text).join(""));

/** Nicht abgehakte Punkte unter einer Überschrift „Offene Fragen“. */
export function openQuestionsOf(doc: PMNode): string[] {
  const out: string[] = [];
  let level = 0;
  for (const n of doc.content ?? []) {
    if (n.type === "heading") {
      const l = Number(n.attrs?.level) || 1;
      if (/^offene fragen\b/i.test(text(n).trim())) level = l;
      else if (level && l <= level) level = 0;
      continue;
    }
    if (!level || n.type !== "taskList") continue;
    for (const item of n.content ?? []) {
      const t = text(item).replace(/\s+/g, " ").trim();
      if (!item.attrs?.checked && t && !/^…+$/.test(t)) out.push(t);
    }
  }
  return out;
}

/** Begriffe im Bereich „Begriffe & Erklärungen“, bei denen die Erklärung fehlt. */
export const missingExplanations = (doc: PMNode) => explanationsOf(doc).filter((e) => !e.text).map((e) => e.term);

/** Hat die Mitschrift schon ein Lernskript (eingefügt)? */
export const hasLernskript = (doc: PMNode) => (doc.content ?? []).some((n) => n.type === "heading" && /^lernskript\b/i.test(text(n).trim()));

/** Ist die Vorlesung nachbereitet? Lernskript in oder neben der Mitschrift oder Karteikarten daraus. */
export function isReviewed(note: StudyNode, doc: PMNode | null, nodes: StudyNode[], cardSources: Set<string>): boolean {
  if (cardSources.has(note.id)) return true;
  if (doc && hasLernskript(doc)) return true;
  return nodes.some((n) => n.kind === "note" && !n.deleted_at && n.parent_id === note.parent_id && n.title === `Lernskript: ${note.title}`);
}

/** Tage in Folge mit Wiederholungen (bis heute; ist heute noch nichts, zählt ab gestern). */
export function streak(reviewsByDay: number[]): number {
  const days = [...reviewsByDay];
  if (!days.at(-1)) days.pop();
  let n = 0;
  for (let i = days.length - 1; i >= 0 && days[i]! > 0; i--) n++;
  return n;
}

// ---------- Kacheln ----------

export const WIDGETS = [
  { id: "jetzt", label: "Jetzt" },
  { id: "lernen", label: "Heute lernen" },
  { id: "pruefung", label: "Nächste Prüfung" },
  { id: "offen", label: "Offene Enden" },
  { id: "veranstaltungen", label: "Veranstaltungen" },
  { id: "notiz", label: "Gedanke festhalten" },
  { id: "zuletzt", label: "Zuletzt bearbeitet" },
] as const;
export type WidgetId = (typeof WIDGETS)[number]["id"];
export const DASHBOARD_SETTING = "ui.dashboard";
export const GOAL_SETTING = "learn.dailyGoal";

export interface DashboardConfig {
  order: WidgetId[];
  hidden: WidgetId[];
}

/** Gespeicherte Anordnung prüfen; neue Kacheln erscheinen am Ende. */
export function dashboardConfig(v: unknown): DashboardConfig {
  const ids = WIDGETS.map((w) => w.id) as WidgetId[];
  const o = v && typeof v === "object" ? (v as Partial<DashboardConfig>) : {};
  const order = (Array.isArray(o.order) ? o.order : []).filter((x, i, a): x is WidgetId => ids.includes(x as WidgetId) && a.indexOf(x) === i);
  const hidden = (Array.isArray(o.hidden) ? o.hidden : []).filter((x): x is WidgetId => ids.includes(x as WidgetId));
  return { order: [...order, ...ids.filter((x) => !order.includes(x))], hidden };
}

export function moveWidget(c: DashboardConfig, id: WidgetId, by: -1 | 1): DashboardConfig {
  const i = c.order.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= c.order.length) return c;
  const order = [...c.order];
  [order[i], order[j]] = [order[j]!, order[i]!];
  return { ...c, order };
}
