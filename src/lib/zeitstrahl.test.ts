import { describe, expect, it } from "vitest";

import { extractEvents, parseWhen, sentences, sortOrder, whenIn } from "./zeitstrahl";

describe("Zeitstrahl", () => {
  it("liest Zeitangaben", () => {
    expect(parseWhen("1.3.2024")).toEqual({ day: 1, month: 2, year: 2024 });
    expect(parseWhen("01.03.24, 10:15 Uhr")).toEqual({ day: 1, month: 2, year: 2024, minutes: 615 });
    expect(parseWhen("3. März 2024")).toEqual({ day: 3, month: 2, year: 2024 });
    expect(parseWhen("Mitte April 2024")).toEqual({ day: 15, month: 3, year: 2024 });
    expect(parseWhen("Dezember 2023")).toEqual({ month: 11, year: 2023 });
    expect(parseWhen("14 Uhr")).toEqual({ minutes: 840 });
    expect(parseWhen("2024")).toEqual({ year: 2024 });
    expect(parseWhen("Zwei Tage später")).toBeNull();
    expect(parseWhen("")).toBeNull();
  });
  it("sortiert und ergänzt fehlende Teile aus dem Vorgänger", () => {
    // „5.3.“ hat das Jahr von davor, „9 Uhr“ den Tag davor, „danach“ bleibt hinter seinem Vorgänger
    const w = ["10.3.2024", "Danach", "1.3.2024, 14 Uhr", "9 Uhr", "5.3.", "Februar 2024", "Ausgangslage"];
    expect(sortOrder(w).map((i) => w[i])).toEqual(["Februar 2024", "Ausgangslage", "9 Uhr", "1.3.2024, 14 Uhr", "5.3.", "10.3.2024", "Danach"]);
    expect(sortOrder(["1.1.2024", "2.1.2024"])).toEqual([0, 1]);
    expect(sortOrder(["", "", ""])).toEqual([0, 1, 2]);
  });
  it("teilt Sätze ohne Datums- und Abkürzungspunkte", () => {
    expect(sentences("Am 1.3.2024 kauft A von B ein Rad, z. B. für 300 €. Am 3. März zahlt A gem. § 433 Abs. 2 BGB. Fertig!")).toEqual([
      "Am 1.3.2024 kauft A von B ein Rad, z. B. für 300 €.",
      "Am 3. März zahlt A gem. § 433 Abs. 2 BGB.",
      "Fertig!",
    ]);
  });
  it("findet die erste Zeitangabe im Satz", () => {
    expect(whenIn("Am 1.3.2024 um 10 Uhr ruft A an.")).toBe("1.3.2024, 10 Uhr");
    expect(whenIn("Zwei Tage später holt B das Rad ab.")).toBe("Zwei Tage später");
    expect(whenIn("Am nächsten Morgen ist das Rad weg.")).toBe("Am nächsten Morgen");
    expect(whenIn("Drei Wochen nach der Übergabe meldet sich C.")).toBe("Drei Wochen nach der Übergabe");
    expect(whenIn("Mitte März 2024 tritt A zurück.")).toBe("Mitte März 2024");
    expect(whenIn("Gegen 23:30 betritt T das Haus.")).toBe("23:30");
    expect(whenIn("A ist Eigentümer eines Fahrrads.")).toBe("");
    expect(whenIn("Nach § 433 Abs. 2 BGB zahlt A 300 €.")).toBe("");
  });
  it("Sachverhalt → Ereignisse", () => {
    const sv =
      "A ist Eigentümer eines Fahrrads. Am 1.3.2024 einigt er sich mit B auf einen Kaufpreis von 300 €. B zahlt sofort. Zwei Tage später holt B das Rad ab. Am 10.3.2024 erklärt A die Anfechtung.";
    expect(extractEvents(sv)).toEqual([
      { when: "Ausgangslage", text: "A ist Eigentümer eines Fahrrads." },
      { when: "1.3.2024", text: "Am 1.3.2024 einigt er sich mit B auf einen Kaufpreis von 300 €. B zahlt sofort." },
      { when: "Zwei Tage später", text: "Zwei Tage später holt B das Rad ab." },
      { when: "10.3.2024", text: "Am 10.3.2024 erklärt A die Anfechtung." },
    ]);
  });
});
