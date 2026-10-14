// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { LegalRetriever, searchTerms, stem } from "./retrieval";
import { parseGiiXml } from "./sources/gii";
import { chunkText } from "./sources/text";
import { createLegalMock } from "../api/mockLegal";

// Erfundenes Testgesetz im Format von gesetze-im-internet.de (kein echter Gesetzestext).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<dokumente builddate="20260101" doknr="TEST">
  <norm builddate="20260101" doknr="TEST">
    <metadaten>
      <jurabk>MustG</jurabk>
      <ausfertigung-datum>2020-01-01</ausfertigung-datum>
      <langue>Mustergesetz für Tests</langue>
      <standangabe><standtyp>Stand</standtyp><standkommentar>Testfassung</standkommentar></standangabe>
    </metadaten>
  </norm>
  <norm><metadaten><jurabk>MustG</jurabk><gliederungseinheit><gliederungsbez>Abschnitt 1</gliederungsbez><gliederungstitel>Allgemeines</gliederungstitel></gliederungseinheit></metadaten></norm>
  <norm>
    <metadaten><jurabk>MustG</jurabk><enbez>§ 1</enbez><titel format="parat">Testpflichten</titel></metadaten>
    <textdaten><text format="XML"><Content>
      <P>(1) Der Prüfling muss die Musteraufgabe lösen.</P>
      <P>(2) Er hat dabei folgende Hilfsmittel:<DL Type="arabic"><DT>1.</DT><DD><LA>das Testskript,</LA></DD><DT>2.</DT><DD><LA>den Musterkommentar.</LA></DD></DL></P>
    </Content></text></textdaten>
  </norm>
  <norm>
    <metadaten><jurabk>MustG</jurabk><enbez>Art 2</enbez><titel>Einheitlicher Absatz</titel></metadaten>
    <textdaten><text format="XML"><Content><P>Diese Norm hat keine nummerierten Absätze.</P></Content></text></textdaten>
  </norm>
</dokumente>`;

describe("Import im Format von gesetze-im-internet.de", () => {
  it("liest Gesetz, Stand und Absätze", () => {
    const law = parseGiiXml(XML, "test");
    expect(law.source).toMatchObject({ kind: "gesetz", abbreviation: "MustG", title: "Mustergesetz für Tests" });
    expect(law.source.version).toContain("Testfassung");
    expect(law.chunks.map((c) => [c.norm, c.absatz])).toEqual([
      ["§ 1", 1],
      ["§ 1", 2],
      ["Art. 2", null],
    ]);
    expect(law.chunks[0]!.heading).toBe("Testpflichten – Abschnitt 1 Allgemeines");
    expect(law.chunks[1]!.text).toContain("1. das Testskript,");
    expect(law.chunks[1]!.text).toContain("\n2. den Musterkommentar.");
  });

  it("lehnt Fremdformate ab", () => {
    expect(() => parseGiiXml("<html></html>")).toThrow(/keine Normen/);
    expect(() => parseGiiXml("kein xml <")).toThrow();
  });
});

describe("Fließtext aufteilen", () => {
  it("teilt an Absätzen und Randnummern", () => {
    const text = "Leitsatz\n\nDer Leitsatz.\n\n1 Die Klägerin begehrt Zahlung.\n\n2 Das Berufungsgericht hat ausgeführt.";
    const chunks = chunkText(text, 40);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.some((c) => c.heading === "Rn. 2")).toBe(true);
  });
  it("teilt überlange Absätze an Satzgrenzen", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Satz Nummer ${i} enthält etwas Text.`).join(" ");
    const chunks = chunkText(long, 300);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.text.length <= 300)).toBe(true);
  });
});

describe("Abruf", () => {
  it("Suchbegriffe ohne Füllwörter, mit Grundform", () => {
    expect(searchTerms("Welche Pflichten hat der Prüfling nach § 1 MustG?")).toEqual(["pflicht", "prüfling", "mustg"]);
    expect(stem("Kaufvertrages")).toBe("kaufvertrag");
  });

  it("lädt genannte Normen vollständig und ergänzt Suchtreffer", async () => {
    const store = createLegalMock();
    const law = parseGiiXml(XML);
    await store.legalSourceSave(law.source, law.chunks);
    const r = new LegalRetriever(store);
    const hits = await r.retrieve("Was regelt § 1 MustG zu Hilfsmitteln?");
    expect(hits.filter((h) => h.norm === "§ 1")).toHaveLength(2);
    const hits2 = await r.retrieve("Absätze nummeriert");
    expect(hits2[0]!.norm).toBe("Art. 2");
  });
});
