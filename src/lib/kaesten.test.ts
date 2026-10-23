// @vitest-environment jsdom
import { Editor, generateHTML } from "@tiptap/core";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { editorExtensions } from "../features/editor/extensions";
import { buildPrintHtml } from "../features/editor/print";
import { CALLOUTS, calloutLabel } from "./callouts";
import { exportDocx } from "./docxExport";
import { toMarkdown } from "./markdownExport";
import { plainText, type PMNode } from "./pm";

const T = (text: string) => ({ type: "text", text });
const P = (text: string): PMNode => ({ type: "paragraph", content: [T(text)] });
const box = (kind: string, title: string, ...content: PMNode[]): PMNode => ({ type: "callout", attrs: { kind, title }, content });
const DOC: PMNode = { type: "doc", content: [P("Einleitung"), box("gesetz", "§ 433 BGB", P("(1) Durch den Kaufvertrag wird der Verkäufer … verpflichtet.")), box("beispiel", "", P("A kauft bei B ein Fahrrad.")), P("Weiter")] };

/** ohne den leeren Absatz, den der Editor nach einem Kasten anhängt (zum Weiterschreiben) */
const blocksOf = (e: Editor) => {
  const c = [...(e.getJSON() as PMNode).content!];
  while (c.length > 1 && c[c.length - 1]!.type === "paragraph" && !c[c.length - 1]!.content?.length) c.pop();
  return c;
};
const editorWith = (content: object) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: editorExtensions(), content });
};

describe("Farbige Kästen", () => {
  it("Beschriftung mit Überschrift", () => {
    expect(calloutLabel("gesetz", "§ 433 BGB")).toBe("Gesetzestext · § 433 BGB");
    expect(calloutLabel("quatsch", "")).toBe("Beispiel");
    expect(CALLOUTS.map((c) => c.label)).toEqual(["Beispiel", "Gesetzestext", "Definition", "Fall", "Merke", "Problem / Streitstand", "Hinweis"]);
  });
  it("Auswahl in Kasten legen, Art ändern, auflösen", () => {
    const e = editorWith({ type: "doc", content: [P("Erster Absatz"), P("Zweiter Absatz")] });
    e.commands.setTextSelection({ from: 2, to: 20 });
    expect(e.commands.setCallout("definition")).toBe(true);
    let j = e.getJSON() as PMNode;
    expect(j.content![0]).toMatchObject({ type: "callout", attrs: { kind: "definition" } });
    expect(j.content![0]!.content).toHaveLength(2);
    e.commands.setTextSelection(4);
    e.commands.setCallout("merke");
    expect(blocksOf(e)).toHaveLength(1);
    expect(blocksOf(e)[0]!.attrs!.kind).toBe("merke");
    e.commands.unsetCallout();
    expect(blocksOf(e).map((n) => n.type)).toEqual(["paragraph", "paragraph"]);
    e.destroy();
  });
  it("Enter im leeren letzten Absatz verlässt den Kasten", () => {
    const e = editorWith({ type: "doc", content: [box("fall", "", P("Sachverhalt"), { type: "paragraph" })] });
    const boxNode = e.state.doc.child(0);
    e.commands.setTextSelection(boxNode.nodeSize - 2);
    e.view.someProp("handleKeyDown", (f) => f(e.view, new KeyboardEvent("keydown", { key: "Enter" })));
    const j = e.getJSON() as PMNode;
    expect(j.content![0]!.type).toBe("callout");
    expect(j.content![0]!.content).toHaveLength(1);
    expect(j.content![1]!.type).toBe("paragraph");
    // Cursor steht jetzt unter dem Kasten
    expect(e.state.selection.$from.depth).toBe(1);
    e.destroy();
  });
  it("Editor zeigt Beschriftung, gespeichert wird nur Art und Überschrift", () => {
    const e = editorWith(DOC);
    const labels = [...e.view.dom.querySelectorAll(".callout-label")].map((b) => b.textContent);
    expect(labels).toEqual(["Gesetzestext · § 433 BGB", "Beispiel"]);
    const saved = JSON.stringify(e.getJSON());
    expect(saved).toContain('"kind":"gesetz"');
    expect(saved).not.toContain("callout-label");
    e.destroy();
  });
  it("HTML, Druck, Markdown, Text und Word", async () => {
    const html = generateHTML(DOC as never, editorExtensions());
    expect(html).toContain('data-callout="gesetz"');
    expect(html).toContain('data-label="Gesetzestext · § 433 BGB"');
    expect(buildPrintHtml(DOC, { title: "T", toc: false, margins: "normal", style: "notiz", pageNumbers: true }, () => undefined)).toContain("callout callout-beispiel");
    const md = toMarkdown(DOC);
    expect(md).toContain("> **Gesetzestext · § 433 BGB**");
    expect(md).toContain("> A kauft bei B ein Fahrrad.");
    expect(plainText(DOC)).toContain("A kauft bei B ein Fahrrad.");
    const zip = await JSZip.loadAsync(await exportDocx(DOC, { title: "T" }));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("GESETZESTEXT · § 433 BGB");
    expect(xml).toContain('w:fill="F3EFF9"');
    expect(xml).toContain('w:color="6B4FA3"');
    expect(xml).toContain("A kauft bei B ein Fahrrad.");
  });
});
