import { describe, expect, it } from "vitest";

import type { Card, ReviewLogEntry } from "../api/types";
import { buttons, byHour, cardCounts, classify, forecast, histogram, intervalHistogram, retention, reviewsByDay, streakInfo, today } from "./cardStats";

const NOW = new Date(2026, 10, 11, 18, 0, 0);
const at = (daysAgo: number, h = 10) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, h).toISOString();
let n = 0;
const card = (over: Partial<Card>): Card => ({
  id: `c${++n}`, area_id: null, node_id: null, kind: "frage", front: "F", back: "B", tags: "", source_type: null, source_id: null, difficult: false, suspended: false,
  due: at(0), stability: 0, difficulty: 5, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null,
  created_at: "", updated_at: "", deleted_at: null, deck: "", template: "basis", fields: "{}", flag: 0, buried_until: null, note_key: null, ord: 0, ...over,
});
const log = (card_id: string, daysAgo: number, rating: number, state_before: number, scheduled_days: number, h = 10, duration_ms = 5000): ReviewLogEntry => ({
  id: `l${++n}`, card_id, rating, state_before, scheduled_days, stability: 1, difficulty: 5, duration_ms, reviewed_at: at(daysAgo, h),
});

describe("Karten-Statistik", () => {
  // Karte A: neu gelernt vor 40 Tagen, dann Intervalle 30 → ausgereift
  const L = [
    log("A", 40, 3, 0, 1),
    log("A", 39, 3, 2, 30), // jung (Intervall davor 1)
    log("A", 9, 3, 2, 60), // ausgereift (Intervall davor 30)
    log("A", 0, 1, 2, 0, 9), // ausgereift, vergessen
    log("B", 0, 3, 3, 1, 14), // neu lernen
    log("C", 0, 4, 0, 3, 14),
    log("C", 1, 3, 1, 1, 22),
  ];
  it("Art jeder Wiederholung", () => {
    expect([...classify(L).values()]).toEqual(["learn", "young", "mature", "learn", "mature", "relearn", "learn"]);
  });
  it("Heute", () => {
    const t = today(L, NOW);
    expect([t.count, t.ms, t.again, t.matureRate]).toEqual([3, 15000, 1, 0]);
    expect(t.byKind).toEqual({ learn: 1, relearn: 1, young: 0, mature: 1 });
  });
  it("Vorhersage, Tage, Serie", () => {
    const cs = [card({ state: 2, due: at(3) }), card({ state: 2, due: at(-2) }), card({ state: 2, due: at(-2), suspended: true }), card({ state: 0 }), card({ state: 1, due: at(-40) })];
    expect(forecast(cs, NOW, 5)).toEqual([1, 0, 1, 0, 0]);
    const days = reviewsByDay(L, NOW, 3);
    expect(days.map((d) => d.total)).toEqual([0, 1, 3]);
    expect(days[2]!.byKind).toEqual({ learn: 1, relearn: 1, young: 0, mature: 1 });
    expect(streakInfo(days)).toEqual({ streak: 2, longest: 2, activeShare: 2 / 3, perDay: 2 });
    expect(streakInfo(reviewsByDay(L.filter((l) => l.reviewed_at < at(0, 0)), NOW, 3)).streak).toBe(1);
  });
  it("Kartenzählung und Histogramme", () => {
    const cs = [card({}), card({ state: 1 }), card({ state: 2, scheduled_days: 5 }), card({ state: 2, scheduled_days: 40 }), card({ suspended: true }), card({ buried_until: "2999-01-01T00:00:00Z" })];
    expect(cardCounts(cs, NOW)).toEqual({ new: 1, learn: 1, young: 1, mature: 1, suspended: 1, buried: 1 });
    expect(histogram([0, 1, 5, 9], [0, 2, 5], (lo, hi) => `${lo}-${hi ?? "∞"}`)).toEqual([
      { label: "0-2", value: 2 },
      { label: "2-5", value: 0 },
      { label: "5-∞", value: 2 },
    ]);
    const ih = intervalHistogram(cs);
    expect(ih.find((b) => b.label === "4–6 T.")!.value).toBe(1);
    expect(ih.find((b) => b.label === "30–59 T.")!.value).toBe(1);
  });
  it("Tageszeiten, Antworttasten, Behaltensquote", () => {
    const h = byHour(L);
    expect(h[14]).toEqual({ hour: 14, count: 2, rate: 1 });
    expect(h[9]).toEqual({ hour: 9, count: 1, rate: 0 });
    const b = buttons(L);
    expect(b.learn).toEqual([0, 0, 3, 1]);
    expect(b.young).toEqual([0, 0, 1, 0]);
    expect(b.mature).toEqual([1, 0, 1, 0]);
    const r = retention(L, NOW);
    expect(r[0]).toEqual({ label: "Heute", young: { n: 0, rate: null }, mature: { n: 1, rate: 0 }, total: { n: 1, rate: 0 } });
    expect(r[3]!.mature).toEqual({ n: 2, rate: 0.5 });
  });
});
