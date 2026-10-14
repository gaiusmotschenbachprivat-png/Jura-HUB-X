import { describe, expect, it } from "vitest";

import { Anonymizer, configFromSettings, DEFAULT_CONFIG } from "./anonymize";

describe("Anonymisierung", () => {
  it("ersetzt Kontakt- und Personendaten und setzt sie wieder ein", () => {
    const a = new Anonymizer();
    const text =
      "Herr Max Müller, geb. am 01.02.1990, wohnt in der Hauptstraße 12, 95444 Bayreuth. " +
      "Mail: max.mueller@example.org, Tel. 0921 123456, IBAN DE89 3704 0044 0532 0130 00.";
    const anon = a.anonymize(text);
    for (const secret of ["Müller", "01.02.1990", "Hauptstraße 12", "95444 Bayreuth", "max.mueller@example.org", "0921 123456", "DE89"]) {
      expect(anon).not.toContain(secret);
    }
    expect(anon).toContain("[PERSON_1]");
    expect(a.deanonymize(anon)).toBe(text);
  });

  it("gleiche Angabe → gleicher Platzhalter, auch in späteren Nachrichten", () => {
    const a = new Anonymizer();
    a.anonymize("Frau Schmidt kündigt.");
    expect(a.anonymize("Schmidt hat Klage erhoben.")).toBe("[PERSON_1] hat Klage erhoben.");
  });

  it("lässt Normen, Gerichtsaktenzeichen und Fallbuchstaben unverändert", () => {
    const a = new Anonymizer();
    const text = "V verkauft an K. Anspruch aus § 433 Abs. 2 BGB; vgl. BGH VIII ZR 123/20. Frist bis 15.03.2026.";
    expect(a.anonymize(text)).toBe(text);
  });

  it("eigene Begriffe werden immer ersetzt", () => {
    const a = new Anonymizer({ ...DEFAULT_CONFIG, customTerms: ["Firma Beispiel GmbH"] });
    expect(a.anonymize("Die Firma Beispiel GmbH haftet.")).toBe("Die [BEGRIFF_1] haftet.");
  });

  it("kann abgeschaltet werden", () => {
    const a = new Anonymizer({ ...DEFAULT_CONFIG, enabled: false });
    expect(a.anonymize("Herr Müller")).toBe("Herr Müller");
  });

  it("liest Einstellungen robust", () => {
    expect(configFromSettings(null)).toEqual(DEFAULT_CONFIG);
    expect(configFromSettings({ enabled: false, customTerms: ["A", 3] }).customTerms).toEqual(["A"]);
  });
});
