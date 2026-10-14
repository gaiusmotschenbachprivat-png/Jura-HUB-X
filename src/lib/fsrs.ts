/**
 * Wiederholungsplanung mit FSRS (Free Spaced Repetition Scheduler, Bibliothek ts-fsrs).
 * Der Kern speichert den Stand; berechnet wird er hier.
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card as FsrsCard, type Grade } from "ts-fsrs";

import type { Card, ReviewInput } from "../api/types";

/** Zielwahrscheinlichkeit, eine Karte bei Fälligkeit noch zu wissen (90 %). */
export const REQUEST_RETENTION = 0.9;

const scheduler = fsrs(generatorParameters({ request_retention: REQUEST_RETENTION, enable_fuzz: true, maximum_interval: 3650 }));

export const RATINGS: { rating: 1 | 2 | 3 | 4; label: string; key: string }[] = [
  { rating: 1, label: "Nochmal", key: "1" },
  { rating: 2, label: "Schwer", key: "2" },
  { rating: 3, label: "Gut", key: "3" },
  { rating: 4, label: "Einfach", key: "4" },
];

export function toFsrs(c: Card): FsrsCard {
  if (c.state === 0 && c.reps === 0) return createEmptyCard(new Date(c.due));
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? new Date(c.last_review) : undefined,
  };
}

/** Neuer Stand nach einer Bewertung. */
export function schedule(c: Card, rating: 1 | 2 | 3 | 4, now = new Date()): ReviewInput {
  const next = scheduler.next(toFsrs(c), now, rating as unknown as Grade).card;
  return {
    rating,
    due: next.due.toISOString(),
    stability: next.stability,
    difficulty: next.difficulty,
    elapsed_days: next.elapsed_days,
    scheduled_days: next.scheduled_days,
    learning_steps: next.learning_steps,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
  };
}

/** Vorschau: wann wäre die Karte je nach Bewertung wieder dran? */
export function previewIntervals(c: Card, now = new Date()): Record<1 | 2 | 3 | 4, string> {
  const p = scheduler.repeat(toFsrs(c), now);
  const label = (d: Date) => formatInterval(d.getTime() - now.getTime());
  return {
    1: label(p[Rating.Again].card.due),
    2: label(p[Rating.Hard].card.due),
    3: label(p[Rating.Good].card.due),
    4: label(p[Rating.Easy].card.due),
  };
}

export function formatInterval(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} Std.`;
  const d = Math.round(h / 24);
  if (d < 31) return d === 1 ? "1 Tag" : `${d} Tage`;
  const mo = Math.round(d / 30);
  if (mo < 12) return mo === 1 ? "1 Monat" : `${mo} Monate`;
  const y = Math.round((d / 365) * 10) / 10;
  return `${String(y).replace(".", ",")} Jahre`;
}

/** Beginn des heutigen Tages (lokale Zeit) als ISO-Zeitpunkt. */
export function startOfToday(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export const STATE_LABEL = ["Neu", "Lernen", "Wiederholen", "Neu lernen"];
