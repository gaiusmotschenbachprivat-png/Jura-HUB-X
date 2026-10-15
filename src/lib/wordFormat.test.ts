// @vitest-environment jsdom
import { Editor, generateHTML, generateJSON, getSchema } from "@tiptap/core";
import { Node as PMNodeClass } from "@tiptap/pm/model";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import { editorExtensions } from "../features/editor/extensions";
import { footnotesOf, indent } from "../features/editor/formatting";
import { convertFootnotes } from "./docxImport";
import { exportDocx, hexColor } from "./docxExport";
import { toMarkdown } from "./markdownExport";
import { doc, plainText, type PMNode } from "./pm";
import { cssLengthToPt, fontSizePt, primaryFont } from "./textFormat";

const styled: PMNode = doc(
  {
    type: "paragraph",
    attrs: { textAlign: "justify", lineHeight: "1.5", indent: 2 },
    content: [
      {
        type: "text",
        text: "Willenserklärung",
        marks: [{ type: "textStyle", attrs: { fontFamily: '"Times New Roman", Times, serif', fontSize: "14pt", color: "#c00000" } }],
      },
      { type: "footnote", attrs: { text: "BGH NJW 2020, 123." } },
      { type: "text", text: " und ", marks: [{ type: "highlight", attrs: { color: "#c5f5c1" } }] },
      { type: "text", text: "2", marks: [{ type: "superscript" }] },
      { type: "text", text: "x", marks: [{ type: "subscript" }] },
      { type: "footnote", attrs: { text: "Vgl. § 119 BGB." } },
    ],
  },
  { type: "pageBreak" },
  { type: "heading", attrs: { level: 2, lineHeight: "2", indent: 0 }, content: [{ type: "text", text: "Neue Seite" }] },
);

describe("Word-ähnliche Formatierung: Schema", () => {
  it("Dokument mit Schrift, Farbe, Fußnoten, Seitenumbruch ist gültig", () => {
    expect(() => PMNodeClass.fromJSON(getSchema(editorExtensions()), styled).check()).not.toThrow();
  });

  it("HTML aus Word (eingefügt) wird mit Formatierung übernommen", () => {
    const html =
      '<p style="line-height: 1.5; margin-left: 72pt; text-align: center"><span style="font-family: Arial; font-size: 14pt; color: #ff0000">rot</span>' +
      '<sup data-footnote="Fundstelle">1</sup><sup>hoch</sup><sub>tief</sub><mark data-color="#b3ecff" style="background-color:#b3ecff">mark</mark></p>' +
      '<div data-page-break=""></div><p>danach</p>';
    const json = generateJSON(html, editorExtensions()) as PMNode;
    const para = json.content![0]!;
    expect(para.attrs).toMatchObject({ lineHeight: "1.5", indent: 2, textAlign: "center" });
    const [rot, fn, hoch, tief, mark] = para.content!;
    expect(rot!.marks![0]).toMatchObject({ type: "textStyle", attrs: { fontFamily: "Arial", fontSize: "14pt", color: "#ff0000" } });
    expect(fn).toMatchObject({ type: "footnote", attrs: { text: "Fundstelle" } });
    expect(hoch!.marks![0]!.type).toBe("superscript");
    expect(tief!.marks![0]!.type).toBe("subscript");
    expect(mark!.marks![0]).toMatchObject({ type: "highlight", attrs: { color: "#b3ecff" } });
    expect(json.content![1]!.type).toBe("pageBreak");
  });

  it("HTML-Ausgabe enthält Stile und Fußnoten-Attribut", () => {
    const html = generateHTML(styled as never, editorExtensions());
    expect(html).toContain("line-height: 1.5");
    expect(html).toContain("margin-left: 5em");
    expect(html).toContain('data-footnote="BGH NJW 2020, 123."');
    expect(html).toContain("data-page-break");
    expect(html).toContain("font-size: 14pt");
  });
});

describe("Word-ähnliche Formatierung: Befehle", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });
  const make = (content: PMNode) => {
    editor = new Editor({ element: document.createElement("div"), extensions: editorExtensions(), content });
    return editor;
  };

  it("Einzug, Zeilenabstand, Schrift, Fußnote, Seitenumbruch", () => {
    const e = make(doc({ type: "paragraph", content: [{ type: "text", text: "Absatz" }] }));
    e.commands.selectAll();
    indent(e, 1);
    indent(e, 1);
    indent(e, -1);
    e.commands.setParagraphLineHeight("2");
    e.commands.setFontFamily("Georgia, serif");
    e.commands.setFontSize("16pt");
    e.commands.setColor("#0070c0");
    let p = (e.getJSON() as PMNode).content![0]!;
    expect(p.attrs).toMatchObject({ indent: 1, lineHeight: "2" });
    expect(p.content![0]!.marks![0]!.attrs).toMatchObject({ fontFamily: "Georgia, serif", fontSize: "16pt", color: "#0070c0" });

    e.commands.setTextSelection(4);
    e.commands.insertFootnote("Erste");
    e.commands.setTextSelection(2);
    e.commands.insertFootnote("Davor");
    expect(footnotesOf(e).map((f) => f.text)).toEqual(["Davor", "Erste"]);

    e.commands.focus("end");
    e.commands.insertPageBreak();
    e.commands.insertContent("Zweite Seite");
    let blocks = (e.getJSON() as PMNode).content!;
    expect(blocks.map((n) => n.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
    expect(plainText(blocks[2]!)).toBe("Zweite Seite");
    // Umbruch mitten im Absatz teilt ihn
    e.commands.setTextSelection(3);
    e.commands.insertPageBreak();
    blocks = (e.getJSON() as PMNode).content!;
    expect(blocks.map((n) => n.type)).toEqual(["paragraph", "pageBreak", "paragraph", "pageBreak", "paragraph"]);
    expect(e.state.selection.empty && e.state.selection.$from.parentOffset === 0 && e.state.selection.$from.parent.type.name === "paragraph").toBe(true);
    expect(plainText(blocks[0]!).startsWith("A[1]")).toBe(true);

    // Formatierung löschen setzt Absatz zurück
    e.commands.selectAll();
    e.chain().unsetMark("textStyle").resetParagraphFormat().run();
    p = (e.getJSON() as PMNode).content![0]!;
    expect(p.attrs).toMatchObject({ indent: 0, lineHeight: null });
    expect(p.content!.find((n) => n.type === "text")!.marks).toBeUndefined();
  });

  it("Einzug in Listen verschiebt die Listenebene", () => {
    const e = make(
      doc({
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
        ],
      }),
    );
    e.commands.setTextSelection(7);
    indent(e, 1);
    const list = (e.getJSON() as PMNode).content![0]!;
    expect(list.content!.length).toBe(1);
    expect(list.content![0]!.content![1]!.type).toBe("bulletList");
  });
});

describe("Word-ähnliche Formatierung: Export", () => {
  it("DOCX enthält Schrift, Größe, Farbe, Hervorhebung, hoch/tief, Abstand, Einzug, Fußnoten, Seitenumbruch", async () => {
    const zip = await JSZip.loadAsync(await exportDocx(styled, { title: "T" }));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain('w:ascii="Times New Roman"');
    expect(xml).toContain('<w:sz w:val="28"/>');
    expect(xml).toContain('<w:color w:val="C00000"/>');
    expect(xml).toMatch(/<w:shd [^>]*w:fill="C5F5C1"/);
    expect(xml).toContain('<w:vertAlign w:val="superscript"/>');
    expect(xml).toContain('<w:vertAlign w:val="subscript"/>');
    expect(xml).toMatch(/<w:spacing [^>]*w:line="360"/);
    expect(xml).toMatch(/<w:spacing [^>]*w:line="480"/);
    expect(xml).toMatch(/<w:ind [^>]*w:left="1440"/);
    expect(xml).toContain('<w:jc w:val="both"/>');
    expect(xml).toContain('<w:br w:type="page"/>');
    expect((xml.match(/<w:footnoteReference /g) ?? []).length).toBe(2);
    const notes = await zip.file("word/footnotes.xml")!.async("string");
    expect(notes).toContain("BGH NJW 2020, 123.");
    expect(notes).toContain("Vgl. § 119 BGB.");
  });

  it("Markdown mit Fußnoten, Suche und Wortzählung enthalten Fußnotentext", () => {
    const md = toMarkdown(styled);
    expect(md).toContain("Willenserklärung[^1]");
    expect(md).toContain("[^1]: BGH NJW 2020, 123.");
    expect(md).toContain("[^2]: Vgl. § 119 BGB.");
    expect(md).toContain("<sup>2</sup>");
    // zweiter Export beginnt wieder bei 1
    expect(toMarkdown(styled)).toContain("[^1]: BGH");
    const text = plainText(styled);
    expect(text).toContain("Willenserklärung[1]");
    expect(text).toMatch(/Fußnoten:\n1 BGH NJW 2020, 123\.\n2 Vgl\. § 119 BGB\./);
  });

  it("Hilfsfunktionen", () => {
    expect(hexColor("#abc")).toBe("AABBCC");
    expect(hexColor("rgb(255, 0, 16)")).toBe("FF0010");
    expect(hexColor("red")).toBeUndefined();
    expect(fontSizePt("16px")).toBe(12);
    expect(fontSizePt("10.5pt")).toBe(10.5);
    expect(cssLengthToPt("1cm")).toBeCloseTo(28.35, 1);
    expect(primaryFont('"Times New Roman", Times, serif')).toBe("Times New Roman");
  });
});

describe("Word-Import: Fußnoten", () => {
  it("mammoth-Fußnoten werden zu Editor-Fußnoten", () => {
    const html =
      '<p>Text<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup> weiter</p>' +
      '<ol><li id="footnote-1"><p> BGHZ 1, 2 <a href="#footnote-ref-1">↑</a></p></li></ol>';
    const out = convertFootnotes(html);
    expect(out).toContain('<sup data-footnote="BGHZ 1, 2"></sup>');
    expect(out).not.toContain("<ol>");
    const json = generateJSON(out, editorExtensions()) as PMNode;
    expect(json.content![0]!.content!.some((n) => n.type === "footnote" && n.attrs?.text === "BGHZ 1, 2")).toBe(true);
  });
});
