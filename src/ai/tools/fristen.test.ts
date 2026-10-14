import { describe, expect, it } from "vitest";

import { berechneFrist, easterSunday, holidays, iso } from "./fristen";

describe("Feiertage", () => {
  it("Ostersonntag", () => {
    expect(iso(easterSunday(2024))).toBe("2024-03-31");
    expect(iso(easterSunday(2025))).toBe("2025-04-20");
    expect(iso(easterSunday(2026))).toBe("2026-04-05");
  });
  it("Länderunterschiede", () => {
    expect(holidays(2026, "BY").get("2026-01-06")).toBe("Heilige Drei Könige");
    expect(holidays(2026, "BE").get("2026-01-06")).toBeUndefined();
    expect(holidays(2026, "BY").get("2026-06-04")).toBe("Fronleichnam");
    expect(holidays(2026, "SN").get("2026-11-18")).toBe("Buß- und Bettag");
    expect(holidays(2026, "HH").get("2026-10-31")).toBe("Reformationstag");
    expect(holidays(2017, "BY").get("2017-10-31")).toBe("Reformationstag");
  });
});

describe("Fristen nach §§ 187 ff. BGB", () => {
  it("Ereignisfrist in Tagen", () => {
    // Zugang Mi 14.10.2026, 14 Tage → Mi 28.10.2026
    expect(berechneFrist({ beginn: "2026-10-14", art: "ereignisfrist", einheit: "tage", anzahl: 14 }).ende).toBe("2026-10-28");
  });
  it("Beginnfrist in Tagen zählt den Anfangstag mit", () => {
    expect(berechneFrist({ beginn: "2026-10-14", art: "beginnfrist", einheit: "tage", anzahl: 14 }).ende).toBe("2026-10-27");
  });
  it("Wochenfrist endet am gleichen Wochentag", () => {
    // Mo 12.10.2026 + 2 Wochen → Mo 26.10.2026
    expect(berechneFrist({ beginn: "2026-10-12", art: "ereignisfrist", einheit: "wochen", anzahl: 2 }).ende).toBe("2026-10-26");
  });
  it("Monatsfrist; fehlender Tag → Monatsende (§ 188 Abs. 3)", () => {
    expect(berechneFrist({ beginn: "2026-01-15", art: "ereignisfrist", einheit: "monate", anzahl: 1 }).ende).toBe("2026-02-16"); // 15.02. ist So → Mo
    const r = berechneFrist({ beginn: "2026-01-31", art: "ereignisfrist", einheit: "monate", anzahl: 1 });
    expect(r.ende_188).toBe("2026-02-28");
    expect(r.begruendung.join(" ")).toContain("§ 188 Abs. 3");
  });
  it("Beginnfrist in Monaten endet am Vortag", () => {
    // Mietbeginn 01.03.2026, 1 Jahr → 28.02.2027 (So) → § 193 → 01.03.2027
    const r = berechneFrist({ beginn: "2026-03-01", art: "beginnfrist", einheit: "jahre", anzahl: 1 });
    expect(r.ende_188).toBe("2027-02-28");
    expect(r.ende).toBe("2027-03-01");
  });
  it("§ 193 BGB: Samstag, Sonntag, Feiertag", () => {
    // Ende Sa 24.10.2026 → Mo 26.10.2026
    const r = berechneFrist({ beginn: "2026-10-10", art: "ereignisfrist", einheit: "wochen", anzahl: 2 });
    expect(r.ende_188).toBe("2026-10-24");
    expect(r.ende).toBe("2026-10-26");
    expect(r.verschoben).toBe(true);
    // Ende auf Allerheiligen (So 01.11.2026) in Bayern → Mo 02.11.
    expect(berechneFrist({ beginn: "2026-10-18", art: "ereignisfrist", einheit: "tage", anzahl: 14, land: "BY" }).ende).toBe("2026-11-02");
    // Ende auf Fr 25.12.2026 → Mo 28.12.2026 (Weihnachten + Wochenende)
    expect(berechneFrist({ beginn: "2026-12-11", art: "ereignisfrist", einheit: "tage", anzahl: 14 }).ende).toBe("2026-12-28");
    // ohne § 193
    expect(berechneFrist({ beginn: "2026-10-10", art: "ereignisfrist", einheit: "wochen", anzahl: 2, paragraph193: false }).ende).toBe("2026-10-24");
  });
  it("lehnt ungültige Angaben ab", () => {
    expect(() => berechneFrist({ beginn: "14.10.2026", art: "ereignisfrist", einheit: "tage", anzahl: 1 })).toThrow(/JJJJ-MM-TT/);
    expect(() => berechneFrist({ beginn: "2026-02-30", art: "ereignisfrist", einheit: "tage", anzahl: 1 })).toThrow(/Ungültiges/);
    expect(() => berechneFrist({ beginn: "2026-02-01", art: "ereignisfrist", einheit: "tage", anzahl: 0 })).toThrow();
  });
});
