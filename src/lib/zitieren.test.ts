// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import type { QuelleData } from "../api/types";
import { editorExtensions } from "../features/editor/extensions";
import { findNormRefs } from "../features/editor/normLinks";
import { buildPrintHtml } from "../features/editor/print";
import { exportDocx } from "./docxExport";
import { bibEntry, bibliography, citedSources, defaultKurz, emptyQuelle, footnoteText, quelleTitle } from "./zitieren";
import { doc, p } from "./pm";
import JSZip from "jszip";

const q = (o: Partial<QuelleData>): QuelleData => ({ ...emptyQuelle(o.art ?? "kommentar"), ...o });

describe("Zitierhilfe", () => {
  const komm = q({ art: "kommentar", autoren: "Ellenberger, Jürgen", titel: "Grüneberg, Bürgerliches Gesetzbuch", auflage: "83", ort: "München", jahr: "2024" });
  const lb = q({ art: "lehrbuch", autoren: "Medicus, Dieter / Petersen, Jens", titel: "Allgemeiner Teil des BGB", auflage: "12. Aufl.", ort: "Heidelberg", jahr: "2023" });
  const auf = q({ art: "aufsatz", autoren: "Muster, Max", titel: "Der Erklärungsirrtum", zeitschrift: "NJW", jahr: "2020", seite: "123" });
  const urt = q({ art: "urteil", gericht: "BGH", datum: "12.3.2020", az: "I ZR 1/19", fundstelle: "NJW 2020, 123" });

  it("Fußnoten im üblichen Format", () => {
    expect(defaultKurz(komm)).toBe("Grüneberg/Ellenberger");
    expect(footnoteText(komm, "§ 119 Rn. 10")).toBe("Grüneberg/Ellenberger, § 119 Rn. 10.");
    expect(footnoteText(lb, "Rn. 744")).toBe("Medicus/Petersen, Rn. 744.");
    expect(footnoteText(auf, "125")).toBe("Muster, NJW 2020, 123 (125).");
    expect(footnoteText(urt, "Rn. 18")).toBe("BGH, Urt. v. 12.3.2020 – I ZR 1/19, NJW 2020, 123 (Rn. 18).");
    expect(footnoteText(q({ art: "urteil", gericht: "BVerfG", titel: "Beschl.", datum: "1.1.2021", az: "1 BvR 1/20" }))).toBe("BVerfG, Beschl. v. 1.1.2021 – 1 BvR 1/20.");
    expect(quelleTitle(urt)).toBe("BGH, 12.3.2020, I ZR 1/19");
  });

  it("Literaturverzeichnis: alphabetisch, ohne Urteile, ohne Doppelte", () => {
    expect(bibEntry(komm)).toBe("Ellenberger, Jürgen, Grüneberg, Bürgerliches Gesetzbuch, 83. Aufl., München 2024 (zitiert: Grüneberg/Ellenberger)");
    expect(bibEntry(lb)).toBe("Medicus, Dieter / Petersen, Jens, Allgemeiner Teil des BGB, 12. Aufl., Heidelberg 2023 (zitiert: Medicus/Petersen)");
    expect(bibEntry(auf)).toBe("Muster, Max, Der Erklärungsirrtum, NJW 2020, S. 123.");
    expect(bibEntry(urt)).toBeNull();
    expect(bibliography([auf, urt, komm, lb, komm])).toEqual([bibEntry(komm), bibEntry(lb), bibEntry(auf)]);
  });

  it("zitierte Quellen einer Notiz, Druck und Word", async () => {
    const d = doc(
      { type: "paragraph", content: [{ type: "text", text: "Text" }, { type: "footnote", attrs: { text: "Grüneberg/Ellenberger, § 119 Rn. 10.", source: "q1", pin: "§ 119 Rn. 10" } }, { type: "footnote", attrs: { text: "frei" } }] },
      { type: "paragraph", content: [{ type: "footnote", attrs: { text: "x", source: "q2" } }, { type: "footnote", attrs: { text: "y", source: "q1" } }] },
    );
    expect(citedSources(d)).toEqual(["q1", "q2"]);
    const html = buildPrintHtml(d, { title: "T", toc: false, margins: "normal", style: "notiz", pageNumbers: true, bibliography: ["A, B, C"] }, () => undefined);
    expect(html).toMatch(/<section class="bib"><h2 class="bib-title">Literaturverzeichnis<\/h2><p class="bib-entry">A, B, C<\/p><\/section><main/);
    const zip = await JSZip.loadAsync(await exportDocx(d, { title: "T", bibliography: ["Ellenberger, Grüneberg"] }));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml.indexOf("Literaturverzeichnis")).toBeLessThan(xml.indexOf(">Text<"));
    expect(xml).toContain("Ellenberger, Grüneberg");
  });
});

describe("Normen antippen", () => {
  it("erkennt Normzitate mit Gesetz und ihre Position", () => {
    const e = new Editor({
      element: document.createElement("div"),
      extensions: editorExtensions(),
      content: doc(p("Nach § 119 Abs. 1 BGB und Art. 12 I GG, nicht aber § 5 ohne Gesetz."), { type: "codeBlock", content: [{ type: "text", text: "§ 1 BGB" }] }),
    });
    const refs = findNormRefs(e.state.doc);
    expect(refs.map((r) => r.ref)).toEqual([
      { law: "BGB", norm: "§ 119", absatz: 1, label: "§ 119 Abs. 1 BGB" },
      { law: "GG", norm: "Art. 12", absatz: 1, label: "Art. 12 Abs. 1 GG" },
    ]);
    expect(e.state.doc.textBetween(refs[0]!.from, refs[0]!.to)).toBe("§ 119 Abs. 1 BGB");
    expect(e.view.dom.querySelectorAll(".norm-ref").length).toBe(2);
    // gespeicherter Inhalt bleibt unverändert (nur Anzeige)
    expect(JSON.stringify(e.getJSON())).not.toContain("norm-ref");
    e.destroy();
  });
});
