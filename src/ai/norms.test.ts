import { describe, expect, it } from "vitest";

import { findCaseCitations, findNormCitations, formatNorm } from "./norms";

const fmt = (t: string) => findNormCitations(t).map(formatNorm);

describe("Normzitate erkennen", () => {
  it("einfache Zitate mit Absatz, Satz, Nummer", () => {
    expect(fmt("nach § 433 Abs. 1 S. 2 BGB ist")).toEqual(["§ 433 Abs. 1 S. 2 BGB"]);
    expect(fmt("§ 1 Abs. 2 Satz 1 Nr. 3 KSchG")).toEqual(["§ 1 Abs. 2 S. 1 Nr. 3 KSchG"]);
    expect(fmt("Art. 20 Abs. 3 GG")).toEqual(["Art. 20 Abs. 3 GG"]);
    expect(fmt("§ 242 StGB")).toEqual(["§ 242 StGB"]);
    expect(fmt("§ 312g BGB")).toEqual(["§ 312g BGB"]);
  });

  it("römische Absatzzahlen (Studienschreibweise)", () => {
    expect(fmt("§ 823 I BGB")).toEqual(["§ 823 Abs. 1 BGB"]);
    expect(fmt("§ 433 II BGB")).toEqual(["§ 433 Abs. 2 BGB"]);
  });

  it("Mehrfachzitate", () => {
    expect(fmt("§§ 433, 434 BGB")).toEqual(["§ 433 BGB", "§ 434 BGB"]);
    expect(fmt("§§ 280 Abs. 1, 3, 281 BGB")).toEqual(["§ 280 Abs. 1 BGB", "§ 280 Abs. 3 BGB", "§ 281 BGB"]);
    expect(fmt("§§ 305 ff. BGB")).toEqual(["§ 305 BGB"]);
  });

  it("Verknüpfung mit i. V. m.", () => {
    expect(fmt("Art. 2 Abs. 1 i. V. m. Art. 1 Abs. 1 GG")).toEqual(["Art. 2 Abs. 1 GG", "Art. 1 Abs. 1 GG"]);
    expect(fmt("§ 280 Abs. 1 i.V.m. § 241 Abs. 2 BGB")).toEqual(["§ 280 Abs. 1 BGB", "§ 241 Abs. 2 BGB"]);
  });

  it("Zitat ohne Gesetz bleibt erkennbar, aber ohne Gesetzesangabe", () => {
    const c = findNormCitations("vgl. § 433 Abs. 1. Danach");
    expect(c).toHaveLength(1);
    expect(c[0]!.law).toBe("");
  });

  it("mehrere Zitate in einem Satz", () => {
    expect(fmt("Ein Anspruch aus § 433 Abs. 2 BGB besteht; § 812 Abs. 1 S. 1 Alt. 1 BGB scheidet aus.")).toEqual([
      "§ 433 Abs. 2 BGB",
      "§ 812 Abs. 1 S. 1 BGB",
    ]);
  });

  it("keine Fehltreffer bei Fließtext", () => {
    expect(fmt("Im Jahr 2020 wurden 3 Verträge geschlossen.")).toEqual([]);
  });
});

describe("Entscheidungen erkennen", () => {
  it("Aktenzeichen und Fundstellen", () => {
    const r = findCaseCitations("BGH, Urt. v. 12.3.2021 – VIII ZR 123/20, NJW 2021, 1234; BVerfG 1 BvR 357/05").map((c) => c.reference);
    expect(r).toContain("VIII ZR 123/20");
    expect(r).toContain("1 BvR 357/05");
    expect(r).toContain("NJW 2021, 1234");
  });
});
