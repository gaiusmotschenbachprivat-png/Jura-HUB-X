// @vitest-environment node
import { describe, expect, it } from "vitest";

import * as legal from "./repo/legal";
import { openTestDb } from "./testing";

const chunks = [
  { norm: "§1", absatz: 1, heading: "Testpflichten", text: "(1) Der Prüfling muss die Musteraufgabe lösen." },
  { norm: "§ 1", absatz: 2, heading: "Testpflichten", text: "(2) Hilfsmittel sind das Testskript und der Musterkommentar." },
  { norm: "Art 2", absatz: null, heading: "Fristen", text: "Die Frist beträgt zwei Wochen." },
];

describe("Rechtsquellen (Browser-Kern)", () => {
  it("speichert, sucht, ruft Normen ab und ersetzt neue Fassungen", async () => {
    const db = await openTestDb();
    const s = legal.save(db, { kind: "gesetz", title: "Mustergesetz", abbreviation: "MustG", version: "Test" }, chunks);
    expect(s.chunk_count).toBe(3);
    // Normalisierung „§1“ → „§ 1“, „Art 2“ → „Art. 2“
    expect(legal.norm(db, "mustg", "§ 1", null)).toHaveLength(2);
    expect(legal.norm(db, "MustG", "§1", 2).map((h) => h.absatz)).toEqual([2]);
    expect(legal.norm(db, "MustG", "Art. 2", null)).toHaveLength(1);
    // ODER-Suche, Überschrift zählt stärker
    const hits = legal.search(db, ["frist", "unbekanntwort"], null, 5);
    expect(hits[0]!.norm).toBe("Art. 2");
    expect(legal.search(db, ["musteraufgabe"], ["urteil"], 5)).toEqual([]);
    expect(legal.search(db, ['"); DROP TABLE legal_chunks; --'], null, 5)).toEqual([]);
    // gleiche Abkürzung → ersetzt
    legal.save(db, { kind: "gesetz", title: "Mustergesetz neu", abbreviation: "MustG" }, chunks.slice(0, 1));
    expect(legal.list(db)).toHaveLength(1);
    expect(legal.search(db, ["hilfsmittel"], null, 5)).toEqual([]);
    const ids = legal.search(db, ["prüfling"], null, 5).map((h) => h.chunk_id);
    expect(legal.chunks(db, ids)).toHaveLength(1);
    legal.remove(db, legal.list(db)[0]!.id);
    expect(legal.list(db)).toEqual([]);
    expect(Number(db.value("SELECT COUNT(*) FROM legal_index"))).toBe(0);
  });

  it("lehnt leere oder ungültige Quellen ab", async () => {
    const db = await openTestDb();
    expect(() => legal.save(db, { kind: "gesetz", title: "X" }, [])).toThrow(/keinen Text/);
    expect(() => legal.save(db, { kind: "x" as never, title: "X" }, chunks)).toThrow(/Unbekannte Art/);
  });
});
