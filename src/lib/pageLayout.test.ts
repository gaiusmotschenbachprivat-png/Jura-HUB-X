import { describe, expect, it } from "vitest";

import { baselineMm, klausurHead, klausurLayout } from "./klausurBogen";
import { contentHeight, gridBreaks, layoutFor, pageBreaks, pageSettings, stride } from "./pageLayout";

const L = layoutFor({ margins: "normal", style: "notiz" });
const C = contentHeight(L);
const S = stride(L);

describe("Seitenansicht A4", () => {
  it("Maße wie im Druck", () => {
    expect(Math.round(L.width)).toBe(794);
    expect(Math.round(L.height)).toBe(1123);
    expect(Math.round(L.left)).toBe(94);
    expect(Math.round(layoutFor({ margins: "korrektur", style: "notiz" }).right)).toBe(265);
    expect(pageSettings({ page: { margins: "korrektur", style: "quatsch" } })).toEqual({ margins: "korrektur", style: "notiz" });
    expect(pageSettings(undefined)).toEqual({ margins: "normal", style: "notiz" });
  });
  it("Block, der nicht mehr passt, rückt auf die nächste Seite", () => {
    const blocks = Array.from({ length: 30 }, (_, i) => ({ top: i * 40, height: 40 }));
    const { gaps, pages } = pageBreaks(blocks, L);
    const perPage = Math.floor(C / 40);
    expect(gaps[0]!.index).toBe(perPage);
    expect(gaps[0]!.page).toBe(0);
    // der verschobene Block beginnt genau am Anfang von Seite 2
    expect(blocks[perPage]!.top + gaps[0]!.height).toBeCloseTo(S, 5);
    expect(pages).toBe(2);
  });
  it("Seitenumbruch erzwingt neue Seite; leeres Dokument hat eine Seite", () => {
    const { gaps, pages } = pageBreaks([{ top: 0, height: 30, pageBreak: true }, { top: 30, height: 30 }, { top: 60, height: 30 }], L);
    expect(gaps.map((g) => g.index)).toEqual([1]);
    expect(pages).toBe(2);
    expect(pageBreaks([], L).pages).toBe(1);
  });
  it("Sehr hoher Block läuft über die Seitengrenze", () => {
    const { gaps, pages } = pageBreaks([{ top: 0, height: 10 }, { top: 10, height: C * 1.5 }, { top: 10 + C * 1.5, height: 20 }], L);
    // kein Zwischenraum vor dem überlangen Block; der nächste passt noch auf Seite 2
    expect(gaps).toEqual([]);
    expect(pages).toBe(2);
  });
});

describe("Zeilenraster (Klausurbogen)", () => {
  const L = klausurLayout();
  const g = L.grid!;
  const R = 27;
  const S = stride(L);
  const blocks = (rows: number[], splittable = true) => {
    let top = 0;
    return rows.map((n) => {
      const b = { top, height: n * g, splittable };
      top += n * g;
      return b;
    });
  };
  it("27 Zeilen à 9 mm je Bogen", () => {
    expect(contentHeight(L) / g).toBeCloseTo(R, 6);
  });
  it("passende Absätze: keine Zwischenräume, eine Seite", () => {
    const r = gridBreaks(blocks([1, 4, 4, 18]), L);
    expect(r.pages).toBe(1);
    expect(r.placements.every((p) => p.before === 0 && p.cuts.length === 0)).toBe(true);
  });
  it("Absatz über die Seitengrenze: läuft ab der ersten überzähligen Zeile weiter", () => {
    const r = gridBreaks(blocks([25, 6]), L);
    expect(r.placements[1]!.cuts).toEqual([{ line: 2, height: S - R * g, page: 0 }]);
    expect(r.pages).toBe(2);
  });
  it("sehr langer Absatz über mehrere Seiten", () => {
    const r = gridBreaks(blocks([60]), L);
    expect(r.placements[0]!.cuts.map((c) => c.line)).toEqual([27, 54]);
    expect(r.pages).toBe(3);
  });
  it("nicht teilbarer Block rückt ganz auf die nächste Seite", () => {
    const r = gridBreaks(blocks([25, 4], false), L);
    expect(r.placements[1]!.before).toBeCloseTo(S - 25 * g, 6);
    expect(r.placements[1]!.page).toBe(1);
  });
  it("Block mit krummer Höhe (Tabelle): nächster Block wieder auf der Linie", () => {
    const r = gridBreaks([{ top: 0, height: 2.4 * g, splittable: false }, { top: 2.4 * g, height: g, splittable: true }], L);
    expect(r.placements[1]!.before).toBeCloseTo(0.6 * g, 6);
  });
  it("Seitenumbruch: nächster Block beginnt oben auf dem nächsten Bogen, der Umbruch selbst belegt keine Zeile", () => {
    const r = gridBreaks([{ top: 0, height: 3 * g, splittable: true }, { top: 3 * g, height: 0, splittable: false, pageBreak: true }, { top: 3 * g, height: g, splittable: true }], L);
    expect(r.placements[2]!.page).toBe(1);
    expect(r.placements[2]!.before).toBeCloseTo(S - 3 * g, 6);
  });
});

describe("Klausurbogen: Kopffelder", () => {
  it("Vorgaben: Fach aus der Veranstaltung, heutiges Datum; gespeicherte Werte gehen vor", () => {
    const d = new Date(2026, 10, 25);
    expect(klausurHead(undefined, { fach: "Grundkurs Strafrecht I", today: d })).toEqual({ fach: "Grundkurs Strafrecht I", name: "", datum: "25.11.2026" });
    expect(klausurHead({ klausur: { fach: "StR AT", name: "Max", datum: "1.12.2026" } }, { fach: "X", today: d })).toEqual({ fach: "StR AT", name: "Max", datum: "1.12.2026" });
  });
  it("Text sitzt senkrecht mittig in der Zeile", () => {
    // 12 pt Times: Grundlinie knapp unter der Mitte der 9-mm-Zeile
    const base = baselineMm(40, 9, 12);
    expect(base).toBeGreaterThan(44.5);
    expect(base).toBeLessThan(46.5);
  });
});
