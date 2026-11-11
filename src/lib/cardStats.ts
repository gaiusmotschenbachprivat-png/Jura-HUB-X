/**
 * Statistiken der Karteikarten aus Karten und Lernprotokoll: Heute,
 * Vorhersage, Kalender, Wiederholungen je Tag nach Art, Kartenzählung,
 * Intervalle, Stabilität, Schwierigkeit, Abrufwahrscheinlichkeit,
 * Tageszeiten, Antworttasten und Behaltensquote. „Ausgereift“ = Intervall
 * von mindestens 21 Tagen.
 */
import type { Card, ReviewLogEntry } from "../api/types";
import { cardStatus } from "./decks";
import { retrievability } from "./fsrs";

export const MATURE_DAYS = 21;
const DAY = 864e5;

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Kalendertage zwischen zwei Zeitpunkten (lokal) */
export const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);

export type ReviewKind = "learn" | "relearn" | "young" | "mature";
export const REVIEW_KINDS: { id: ReviewKind; label: string }[] = [
  { id: "learn", label: "Lernen" },
  { id: "relearn", label: "Neu lernen" },
  { id: "young", label: "Jung" },
  { id: "mature", label: "Ausgereift" },
];

/** Art jeder Wiederholung: nach Zustand davor und dem Intervall davor (aus dem vorigen Eintrag der Karte) */
export function classify(log: ReviewLogEntry[]): Map<string, ReviewKind> {
  const sorted = [...log].sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));
  const lastIvl = new Map<string, number>();
  const out = new Map<string, ReviewKind>();
  for (const l of sorted) {
    const prev = lastIvl.get(l.card_id) ?? 0;
    out.set(l.id, l.state_before === 3 ? "relearn" : l.state_before === 2 ? (prev >= MATURE_DAYS ? "mature" : "young") : "learn");
    lastIvl.set(l.card_id, l.scheduled_days);
  }
  return out;
}

export interface TodaySummary {
  count: number;
  ms: number;
  again: number;
  byKind: Record<ReviewKind, number>;
  /** Anteil „gewusst“ bei ausgereiften Karten (null = keine) */
  matureRate: number | null;
}

export function today(log: ReviewLogEntry[], now: Date): TodaySummary {
  const start = startOfDay(now).toISOString();
  const kinds = classify(log);
  const t = log.filter((l) => l.reviewed_at >= start);
  const byKind: Record<ReviewKind, number> = { learn: 0, relearn: 0, young: 0, mature: 0 };
  for (const l of t) byKind[kinds.get(l.id)!]++;
  const mature = t.filter((l) => kinds.get(l.id) === "mature");
  return {
    count: t.length,
    ms: t.reduce((s, l) => s + l.duration_ms, 0),
    again: t.filter((l) => l.rating === 1).length,
    byKind,
    matureRate: mature.length ? mature.filter((l) => l.rating > 1).length / mature.length : null,
  };
}

/** Fällige Karten je Tag ab heute (Überfällige zählen heute), ohne neue und ausgesetzte */
export function forecast(cards: Card[], now: Date, days: number): number[] {
  const out = new Array<number>(days).fill(0);
  for (const c of cards) {
    if (c.suspended || c.deleted_at || c.state === 0) continue;
    const d = Math.max(0, daysBetween(now, new Date(c.due)));
    if (d < days) out[d]!++;
  }
  return out;
}

export interface DayReviews {
  key: string;
  date: Date;
  byKind: Record<ReviewKind, number>;
  total: number;
  ms: number;
}

/** Wiederholungen je Tag nach Art, die letzten `days` Tage (letzter Eintrag = heute) */
export function reviewsByDay(log: ReviewLogEntry[], now: Date, days: number): DayReviews[] {
  const kinds = classify(log);
  const out: DayReviews[] = Array.from({ length: days }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - i));
    return { key: dayKey(date), date, byKind: { learn: 0, relearn: 0, young: 0, mature: 0 }, total: 0, ms: 0 };
  });
  const idx = new Map(out.map((d, i) => [d.key, i]));
  for (const l of log) {
    const i = idx.get(dayKey(new Date(l.reviewed_at)));
    if (i === undefined) continue;
    const d = out[i]!;
    d.byKind[kinds.get(l.id)!]++;
    d.total++;
    d.ms += l.duration_ms;
  }
  return out;
}

/** Tage in Folge mit Wiederholungen (heute zählt, wenn schon gelernt; sonst ab gestern) und Durchschnitt */
export function streakInfo(days: DayReviews[]): { streak: number; longest: number; activeShare: number; perDay: number } {
  let streak = 0;
  let i = days.length - 1;
  if (i >= 0 && !days[i]!.total) i--;
  for (; i >= 0 && days[i]!.total; i--) streak++;
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.total ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const active = days.filter((d) => d.total).length;
  const total = days.reduce((s, d) => s + d.total, 0);
  return { streak, longest, activeShare: days.length ? active / days.length : 0, perDay: active ? total / active : 0 };
}

export type CountKind = "new" | "learn" | "young" | "mature" | "suspended" | "buried";
export const COUNT_KINDS: { id: CountKind; label: string }[] = [
  { id: "new", label: "Neu" },
  { id: "learn", label: "Lernen" },
  { id: "young", label: "Jung" },
  { id: "mature", label: "Ausgereift" },
  { id: "suspended", label: "Ausgesetzt" },
  { id: "buried", label: "Zurückgestellt" },
];

export function cardCounts(cards: Card[], now: Date): Record<CountKind, number> {
  const nowIso = now.toISOString();
  const out: Record<CountKind, number> = { new: 0, learn: 0, young: 0, mature: 0, suspended: 0, buried: 0 };
  for (const c of cards) {
    if (c.deleted_at) continue;
    const s = cardStatus(c, nowIso);
    if (s === "review") out[c.scheduled_days >= MATURE_DAYS ? "mature" : "young"]++;
    else out[s]++;
  }
  return out;
}

export interface Bucket {
  label: string;
  value: number;
}

/** Häufigkeiten in Klassen; `edges` = Untergrenzen (letzte Klasse offen) */
export function histogram(values: number[], edges: number[], label: (lo: number, hi: number | null) => string): Bucket[] {
  return edges.map((lo, i) => {
    const hi = edges[i + 1] ?? null;
    return { label: label(lo, hi), value: values.filter((v) => v >= lo && (hi === null || v < hi)).length };
  });
}

const dayLabel = (lo: number, hi: number | null) => (hi === null ? `ab ${lo} T.` : hi - lo === 1 ? `${lo} T.` : `${lo}–${hi - 1} T.`);
const DAY_EDGES = [0, 1, 2, 3, 4, 7, 14, 21, 30, 60, 90, 180, 365];

export const intervalHistogram = (cards: Card[]) =>
  histogram(
    cards.filter((c) => !c.deleted_at && !c.suspended && c.state === 2).map((c) => c.scheduled_days),
    DAY_EDGES,
    dayLabel,
  );

export const stabilityHistogram = (cards: Card[]) =>
  histogram(
    cards.filter((c) => !c.deleted_at && c.state !== 0).map((c) => c.stability),
    DAY_EDGES,
    dayLabel,
  );

/** Schwierigkeit 1–10 als Prozent in Zehnerschritten */
export const difficultyHistogram = (cards: Card[]) =>
  histogram(
    cards.filter((c) => !c.deleted_at && c.state !== 0).map((c) => ((c.difficulty - 1) / 9) * 100),
    [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
    (lo) => `${lo}–${lo + 10} %`,
  );

export function retrievabilityHistogram(cards: Card[], now: Date): { buckets: Bucket[]; average: number | null } {
  const rs = cards.filter((c) => !c.deleted_at && !c.suspended).map((c) => retrievability(c, now)).filter((r): r is number => r !== null).map((r) => r * 100);
  return {
    buckets: histogram(rs, [0, 50, 60, 70, 80, 85, 90, 95], (lo, hi) => (hi === null ? `ab ${lo} %` : `${lo}–${hi} %`)),
    average: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length / 100 : null,
  };
}

/** Wiederholungen je Stunde (0–23) mit Anteil „gewusst“ */
export function byHour(log: ReviewLogEntry[]): { hour: number; count: number; rate: number | null }[] {
  const out = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, ok: 0 }));
  for (const l of log) {
    const h = new Date(l.reviewed_at).getHours();
    out[h]!.count++;
    if (l.rating > 1) out[h]!.ok++;
  }
  return out.map((o) => ({ hour: o.hour, count: o.count, rate: o.count ? o.ok / o.count : null }));
}

/** Antworttasten je Art (Lernen/Jung/Ausgereift) */
export function buttons(log: ReviewLogEntry[]): Record<"learn" | "young" | "mature", [number, number, number, number]> {
  const kinds = classify(log);
  const out = { learn: [0, 0, 0, 0] as [number, number, number, number], young: [0, 0, 0, 0] as [number, number, number, number], mature: [0, 0, 0, 0] as [number, number, number, number] };
  for (const l of log) {
    const k = kinds.get(l.id)!;
    const g = k === "mature" ? "mature" : k === "young" ? "young" : "learn";
    out[g][l.rating - 1]!++;
  }
  return out;
}

export interface RetentionRow {
  label: string;
  young: { n: number; rate: number | null };
  mature: { n: number; rate: number | null };
  total: { n: number; rate: number | null };
}

/** Tatsächliche Behaltensquote bei Wiederholungen (nicht Lernkarten) für verschiedene Zeiträume */
export function retention(log: ReviewLogEntry[], now: Date): RetentionRow[] {
  const kinds = classify(log);
  const start = startOfDay(now).getTime();
  const periods: [string, number, number][] = [
    ["Heute", start, Infinity],
    ["Gestern", start - DAY, start],
    ["Letzte Woche", start - 6 * DAY, Infinity],
    ["Letzter Monat", start - 29 * DAY, Infinity],
    ["Letztes Jahr", start - 364 * DAY, Infinity],
  ];
  const rate = (ls: ReviewLogEntry[]) => ({ n: ls.length, rate: ls.length ? ls.filter((l) => l.rating > 1).length / ls.length : null });
  return periods.map(([label, from, to]) => {
    const ls = log.filter((l) => {
      const t = Date.parse(l.reviewed_at);
      const k = kinds.get(l.id);
      return t >= from && t < to && (k === "young" || k === "mature");
    });
    return { label, young: rate(ls.filter((l) => kinds.get(l.id) === "young")), mature: rate(ls.filter((l) => kinds.get(l.id) === "mature")), total: rate(ls) };
  });
}
