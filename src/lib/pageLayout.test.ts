import { describe, expect, it } from "vitest";

import { contentHeight, layoutFor, pageBreaks, pageSettings, stride } from "./pageLayout";

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
