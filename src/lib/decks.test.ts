import { describe, expect, it } from "vitest";

import type { Card, ReviewLogEntry } from "../api/types";
import { cardQuestion, cardsForNote, clozeNumbers, clozeParts, clozePlain, noteProblem, schemaPoints } from "./cardModel";
import { addTag, applyLimits, becameLeech, buildDeckTree, buildQueue, cardStatus, DEFAULT_OPTIONS, flattenTree, inDeck, nextCard, normDeck, optionsFor, parseDeckSettings, removeTag, staysToday, tagList, todayUsage } from "./decks";
import { schedule } from "./fsrs";

const NOW = new Date(2026, 10, 11, 10, 0, 0);
const iso = (min: number) => new Date(NOW.getTime() + min * 60000).toISOString();
let n = 0;
const card = (over: Partial<Card>): Card => ({
  id: `c${++n}`, area_id: null, node_id: null, kind: "frage", front: "F", back: "B", tags: "", source_type: null, source_id: null, difficult: false, suspended: false,
  due: iso(-60), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null,
  created_at: `2026-01-01T00:00:${String(n % 60).padStart(2, "0")}Z`, updated_at: "", deleted_at: null, deck: "", template: "basis", fields: "{}", flag: 0, buried_until: null, note_key: null, ord: 0, ...over,
});

describe("Kartentypen", () => {
  it("Lückentext: Nummern, Teile, Klartext", () => {
    const t = "Die {{c1::Willenserklärung}} besteht aus {{c2::Handlungswille::subjektiv}} und {{c1::Erklärungsbewusstsein}}.";
    expect(clozeNumbers(t)).toEqual([1, 2]);
    expect(clozeParts(t, 2, false).map((p) => `${p.kind}:${p.text}`)).toEqual(["plain:Die ", "other:Willenserklärung", "plain: besteht aus ", "gap:subjektiv", "plain: und ", "other:Erklärungsbewusstsein", "plain:."]);
    expect(clozeParts(t, 1, true).filter((p) => p.kind === "answer").map((p) => p.text)).toEqual(["Willenserklärung", "Erklärungsbewusstsein"]);
    expect(clozePlain(t)).toBe("Die Willenserklärung besteht aus Handlungswille und Erklärungsbewusstsein.");
    expect(cardQuestion({ template: "luecke", front: t, back: "", ord: 1 })).toBe("Die […] besteht aus Handlungswille und […].");
  });
  it("Eintrag → Karten", () => {
    let k = 0;
    const key = () => `k${++k}`;
    const base = { front: "", back: "", fields: {}, deck: "Zivilrecht", tags: "", area_id: null };
    const cl = cardsForNote({ ...base, template: "luecke", front: "A {{c1::x}} B {{c2::y}}" }, key);
    expect(cl.map((c) => [c.ord, c.note_key, c.back])).toEqual([
      [1, "k1", "A x B y"],
      [2, "k1", "A x B y"],
    ]);
    expect(cardsForNote({ ...base, template: "umgekehrt", front: "§ 433 BGB", back: "Kaufvertrag" }, key).map((c) => c.ord)).toEqual([0, 1]);
    const d = cardsForNote({ ...base, template: "definition", front: "Sache", back: "Körperlicher Gegenstand", fields: { norm: " § 90 BGB ", beispiel: "" } }, key);
    expect(d).toHaveLength(1);
    expect([d[0]!.kind, d[0]!.fields, d[0]!.note_key]).toEqual(["definition", '{"norm":"§ 90 BGB"}', undefined]);
    expect(cardQuestion({ template: "umgekehrt", front: "§ 433 BGB", back: "Kaufvertrag", ord: 1 })).toBe("Kaufvertrag");
    expect(noteProblem({ template: "definition", front: "Sache", back: "" })).toMatch(/Definition/);
    expect(noteProblem({ template: "luecke", front: "ohne Lücke", back: "" })).toMatch(/Lücke/);
    expect(noteProblem({ template: "luecke", front: "mit {{c1::Lücke}}", back: "" })).toBeNull();
  });
  it("Schema-Punkte mit Ebenen", () => {
    expect(schemaPoints("I. Tatbestand\n  1. Objektiv\n    - Handlung\n  2. Subjektiv\n- - Vorsatz\nII. Rechtswidrigkeit\n\n")).toEqual([
      { level: 0, text: "I. Tatbestand" },
      { level: 1, text: "1. Objektiv" },
      { level: 2, text: "Handlung" },
      { level: 1, text: "2. Subjektiv" },
      { level: 1, text: "Vorsatz" },
      { level: 0, text: "II. Rechtswidrigkeit" },
    ]);
  });
});

describe("Stapel", () => {
  it("Pfade, Optionen mit Vererbung, Schlagwörter", () => {
    expect(normDeck(" Zivilrecht ::: BGB AT ::")).toBe("Zivilrecht::BGB AT");
    expect(inDeck("Zivilrecht::BGB AT", "Zivilrecht")).toBe(true);
    expect(inDeck("Zivilrechtliches", "Zivilrecht")).toBe(false);
    const s = parseDeckSettings({ decks: ["Strafrecht", 3], options: { Zivilrecht: { newPerDay: 5, retention: 2 }, "Zivilrecht::BGB AT": { reviewsPerDay: 50 } } });
    expect(s.decks).toEqual(["Strafrecht"]);
    const o = optionsFor(s, "Zivilrecht::BGB AT::Anfechtung");
    expect([o.newPerDay, o.reviewsPerDay, o.retention]).toEqual([5, 50, 0.99]);
    expect(optionsFor(s, "Strafrecht")).toEqual(DEFAULT_OPTIONS);
    expect(tagList("BGB AT, Anfechtung;  ,BGB AT")).toEqual(["BGB AT", "Anfechtung"]);
    expect(addTag("BGB AT", "Problemkarte")).toBe("BGB AT, Problemkarte");
    expect(addTag("problemkarte", "Problemkarte")).toBe("problemkarte");
    expect(removeTag("BGB AT, Problemkarte", "problemkarte")).toBe("BGB AT");
  });

  it("Baum mit Tageslimits; Lernkarten unbegrenzt; Zurückgestellte und Ausgesetzte zählen nicht", () => {
    const cards = [
      ...Array.from({ length: 30 }, () => card({ deck: "Zivilrecht::BGB AT" })),
      card({ deck: "Zivilrecht::BGB AT", state: 2, due: iso(-10) }),
      card({ deck: "Zivilrecht::BGB AT", state: 2, due: iso(600) }), // heute später noch fällig
      card({ deck: "Zivilrecht::BGB AT", state: 2, due: iso(60 * 24 * 3) }),
      card({ deck: "Zivilrecht::Schuldrecht", state: 1, due: iso(5) }),
      card({ deck: "Zivilrecht::Schuldrecht", state: 2, due: iso(-5), buried_until: iso(60 * 20) }),
      card({ deck: "Strafrecht", state: 2, due: iso(-5), suspended: true }),
      card({ deck: "" }),
    ];
    const s = parseDeckSettings({ decks: ["Öffentliches Recht"] });
    const tree = buildDeckTree(cards, s, NOW, new Map());
    const row = (p: string) => flattenTree(tree, new Set()).find((x) => x.path === p)!.counts;
    expect(flattenTree(tree, new Set()).map((x) => x.path)).toEqual(["Öffentliches Recht", "Strafrecht", "Zivilrecht", "Zivilrecht::BGB AT", "Zivilrecht::Schuldrecht", "Standard"]);
    expect(row("Zivilrecht::BGB AT")).toEqual({ new: 20, learn: 0, review: 2, total: 33 });
    expect(row("Zivilrecht::Schuldrecht")).toEqual({ new: 0, learn: 1, review: 0, total: 2 });
    expect(row("Zivilrecht")).toEqual({ new: 20, learn: 1, review: 2, total: 35 });
    expect(row("Strafrecht")).toEqual({ new: 0, learn: 0, review: 0, total: 1 });
    expect(flattenTree(tree, new Set(["Zivilrecht"])).map((x) => x.path)).toEqual(["Öffentliches Recht", "Strafrecht", "Zivilrecht", "Standard"]);
    // heute schon 15 neue eingeführt → noch 5
    const usage = new Map([["Zivilrecht::BGB AT", { newDone: 15, reviewsDone: 0 }]]);
    expect(flattenTree(buildDeckTree(cards, s, NOW, usage), new Set()).find((x) => x.path === "Zivilrecht::BGB AT")!.counts.new).toBe(5);
  });

  it("Heute verbraucht: neue Karten je Stapel einmal gezählt", () => {
    const a = card({ deck: "Z::A" });
    const b = card({ deck: "Z::B" });
    const map = new Map([a, b].map((c) => [c.id, c]));
    const log = (card_id: string, state_before: number, at: string): ReviewLogEntry => ({ id: Math.random().toString(), card_id, rating: 3, state_before, scheduled_days: 0, stability: 0, difficulty: 0, duration_ms: 0, reviewed_at: at });
    const u = todayUsage([log(a.id, 0, iso(-30)), log(a.id, 1, iso(-20)), log(a.id, 0, iso(-19)), log(b.id, 2, iso(-5)), log(b.id, 2, "2000-01-01T00:00:00Z")], map, new Date(2026, 10, 11).toISOString());
    expect(u.get("Z")).toEqual({ newDone: 1, reviewsDone: 1 });
    expect(u.get("Z::A")).toEqual({ newDone: 1, reviewsDone: 0 });
  });
});

describe("Lernsitzung", () => {
  it("Reihenfolge: fällige Lernkarten, dann Wiederholungen und neue gemischt; Lernschritte", () => {
    const l = card({ state: 1, due: iso(-1) });
    const lSoon = card({ state: 3, due: iso(15) });
    const rs = [card({ state: 2, due: iso(-100) }), card({ state: 2, due: iso(-50) })];
    const ns = [card({}), card({})];
    const q = buildQueue([...ns, ...rs, l, lSoon, card({ state: 0, suspended: true })], NOW, { newLeft: 1, reviewsLeft: 5 }, { newOrder: "added" });
    expect(q.learning.map((c) => c.id)).toEqual([l.id, lSoon.id]);
    expect(q.main).toHaveLength(3);
    expect(q.main.filter((c) => c.state === 0)).toHaveLength(1);
    expect(nextCard(q.learning, q.main, NOW)!.card.id).toBe(l.id);
    expect(nextCard([lSoon], [], NOW)!.card.id).toBe(lSoon.id);
    expect(nextCard([card({ state: 1, due: iso(30) })], [], NOW)).toBeNull();
    // „Nochmal“ bei neuer Karte → Lernschritt 1 Min., heute noch einmal
    const after = { ...ns[0]!, ...schedule(ns[0]!, 1, NOW, { learningSteps: "1m 10m" }) } as Card;
    expect(after.state).toBe(1);
    expect(Math.round((Date.parse(after.due) - NOW.getTime()) / 60000)).toBe(1);
    expect(staysToday(after, NOW)).toBe(true);
    expect(cardStatus(card({ buried_until: iso(10) }), NOW.toISOString())).toBe("buried");
  });
  it("Problemkarte ab Schwelle, danach alle halbe Schwelle", () => {
    const b = (lapses: number) => card({ lapses });
    expect(becameLeech(b(7), b(8), 8)).toBe(true);
    expect(becameLeech(b(8), b(9), 8)).toBe(false);
    expect(becameLeech(b(11), b(12), 8)).toBe(true);
    expect(becameLeech(b(7), b(7), 8)).toBe(false);
    expect(becameLeech(b(7), b(8), 0)).toBe(false);
  });
  it("Tageslimits über Ober- und Unterstapel", () => {
    const s = parseDeckSettings({ options: { Z: { newPerDay: 3 }, "Z::A": { newPerDay: 2 } } });
    const a = Array.from({ length: 4 }, () => card({ deck: "Z::A" }));
    const b = Array.from({ length: 4 }, () => card({ deck: "Z::B" }));
    const got = applyLimits([...a, ...b], "new", s, new Map());
    expect(got.map((c) => c.deck)).toEqual(["Z::A", "Z::A", "Z::B"]);
    // Unterstapel allein lernen: nur seine Limits (geerbt: 3), nicht die bereits verbrauchten Plätze des Oberstapels
    expect(applyLimits(b, "new", s, new Map([["Z", { newDone: 3, reviewsDone: 0 }]]), "Z::B")).toHaveLength(3);
    expect(applyLimits(a, "new", s, new Map([["Z::A", { newDone: 1, reviewsDone: 0 }]]), "Z::A")).toHaveLength(1);
  });
});
