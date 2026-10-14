import { describe, expect, it } from "vitest";

import type { Card } from "../api/types";
import { formatInterval, previewIntervals, schedule } from "./fsrs";
import { gliederung, roman } from "./gliederung";

const newCard = (): Card => ({
  id: "c",
  area_id: null,
  node_id: null,
  kind: "frage",
  front: "?",
  back: "!",
  tags: "",
  source_type: null,
  source_id: null,
  difficult: false,
  suspended: false,
  due: "2026-10-14T08:00:00.000Z",
  stability: 0,
  difficulty: 0,
  elapsed_days: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 0,
  lapses: 0,
  state: 0,
  last_review: null,
  created_at: "",
  updated_at: "",
  deleted_at: null,
});

describe("Wiederholungsplanung (FSRS)", () => {
  const now = new Date("2026-10-14T08:00:00.000Z");

  it("plant neue Karten je nach Bewertung unterschiedlich weit", () => {
    const again = schedule(newCard(), 1, now);
    const good = schedule(newCard(), 3, now);
    const easy = schedule(newCard(), 4, now);
    expect(Date.parse(again.due)).toBeLessThan(Date.parse(good.due));
    expect(Date.parse(good.due)).toBeLessThanOrEqual(Date.parse(easy.due));
    expect(easy.state).toBe(2); // „Einfach“ geht direkt in die Wiederholung
    expect(good.reps).toBe(1);
    expect(Number.isFinite(good.stability) && good.stability > 0).toBe(true);
  });

  it("Abstände wachsen bei wiederholtem „Gut“ und schrumpfen nach „Nochmal“", () => {
    let c = newCard();
    let t = now;
    const gaps: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = schedule(c, 3, t);
      gaps.push(Date.parse(r.due) - t.getTime());
      c = { ...c, ...r, last_review: t.toISOString() };
      t = new Date(r.due);
    }
    expect(gaps[4]!).toBeGreaterThan(gaps[2]!);
    const lapse = schedule(c, 1, t);
    expect(lapse.lapses).toBe(1);
    expect(Date.parse(lapse.due) - t.getTime()).toBeLessThan(gaps[4]!);
  });

  it("Vorschau liefert lesbare Abstände", () => {
    const p = previewIntervals(newCard(), now);
    expect(Object.keys(p)).toHaveLength(4);
    expect(formatInterval(10 * 60000)).toBe("10 Min.");
    expect(formatInterval(3 * 86400000)).toBe("3 Tage");
    expect(formatInterval(400 * 86400000)).toBe("1,1 Jahre");
  });
});

describe("Juristische Gliederung", () => {
  it("nummeriert A. I. 1. a) aa) (1)", () => {
    expect([0, 1, 2, 3, 4, 5].map((d) => gliederung(d, 2))).toEqual(["B.", "II.", "2.", "b)", "bb)", "(2)"]);
    expect(gliederung(1, 4)).toBe("IV.");
    expect(gliederung(0, 27)).toBe("AA.");
    expect(roman(1994)).toBe("MCMXCIV");
  });
});

import { flatten, indent, insertAfter, move, newItem, outdent, remove, toOutline } from "./schemaTree";

describe("Prüfungsschema-Baum", () => {
  const base = () => {
    const a = { ...newItem("Anspruch entstanden"), id: "a" };
    const b = { ...newItem("Vertragsschluss"), id: "b" };
    const c = { ...newItem("Wirksamkeit"), id: "c" };
    return [a, b, c];
  };

  it("einrücken und ausrücken", () => {
    let t = indent(base(), "b");
    t = indent(t, "c");
    expect(t).toHaveLength(1);
    expect(t[0]!.children.map((x) => x.id)).toEqual(["b", "c"]);
    expect(indent(t, "a")).toBe(t); // erster Punkt kann nicht eingerückt werden
    const o = outdent(t, "b");
    expect(o.map((x) => x.id)).toEqual(["a", "b"]);
    expect(o[1]!.children.map((x) => x.id)).toEqual(["c"]); // Nachfolger wandern mit
  });

  it("einfügen, löschen, verschieben", () => {
    const { items, id } = insertAfter(base(), "a");
    expect(items[1]!.id).toBe(id);
    const nested = indent(base(), "b");
    const r = remove(nested, "a");
    expect(r.map((x) => x.id)).toEqual(["b", "c"]); // Unterpunkte bleiben erhalten
    expect(move(base(), "c", -1).map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(move(base(), "a", -1).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("Gliederung als Text", () => {
    const t = indent(indent(base(), "b"), "c");
    expect(flatten(t).map((r) => r.depth)).toEqual([0, 1, 1]);
    expect(toOutline(t, (d, n) => (d === 0 ? "A." : `${["I", "II"][n - 1]}.`))).toBe("A. Anspruch entstanden\n   I. Vertragsschluss\n   II. Wirksamkeit");
  });
});
