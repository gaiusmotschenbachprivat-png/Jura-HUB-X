// @vitest-environment jsdom
import { Editor, generateHTML } from "@tiptap/core";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { exportDocx } from "../../lib/docxExport";
import { toMarkdown } from "../../lib/markdownExport";
import { parseSketch } from "../../lib/personenskizze";
import { plainText, type PMNode } from "../../lib/pm";
import { editorExtensions } from "./extensions";

const P = (text: string): PMNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const editorWith = (content: PMNode[]) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: editorExtensions(), content: { type: "doc", content } });
};

describe("Personenskizze im Editor", () => {
  it("aus markierten Zeilen der Kurzschreibweise", () => {
    const e = editorWith([P("Personenskizze"), P("A—§ 433 I BGB→G"), P("A←$ 433 II BGB—G"), P("Weiter")]);
    e.commands.setTextSelection({ from: 17, to: 50 });
    expect(e.commands.personSketchFromSelection()).toBe(true);
    const doc = e.getJSON() as PMNode;
    const i = doc.content!.findIndex((n) => n.type === "personSketch");
    expect(doc.content![i - 1]!.content?.[0]?.text).toContain("433 II");
    const s = parseSketch(doc.content![i]!.attrs!.data);
    expect(s.persons.map((p) => p.name)).toEqual(["A", "G"]);
    expect(s.relations.map((r) => r.label)).toEqual(["§ 433 I BGB", "§ 433 II BGB"]);
    // ohne erkennbare Zeilen: nichts
    const f = editorWith([P("Nur Text")]);
    f.commands.setTextSelection({ from: 1, to: 9 });
    expect(f.commands.personSketchFromSelection()).toBe(false);
    expect(f.commands.insertPersonSketch()).toBe(true);
    expect((f.getJSON() as PMNode).content!.some((n) => n.type === "personSketch")).toBe(true);
  });

  it("Darstellung (SVG), Volltext, Markdown, Word", async () => {
    const e = editorWith([P("A—§ 433 I BGB→G")]);
    e.commands.setTextSelection({ from: 1, to: 16 });
    e.commands.personSketchFromSelection();
    const doc = e.getJSON() as PMNode;
    const data = JSON.parse(doc.content!.find((n) => n.type === "personSketch")!.attrs!.data as string);
    data.persons[0].role = "Käufer";
    const node: PMNode = { type: "doc", content: [{ type: "personSketch", attrs: { data: JSON.stringify(data) } }] };
    const html = generateHTML(node as never, editorExtensions());
    expect(html).toMatch(/<figure[^>]*class="person-sketch"/);
    expect(html).toMatch(/<figure[^>]*data-sketch=/);
    expect(html).toContain("<svg");
    expect(html).toContain("marker-end");
    expect(html).toContain("§ 433 I BGB");
    // Editor liest die eigene Ausgabe wieder ein
    const back = editorWith([]);
    back.commands.setContent(html);
    expect(parseSketch((back.getJSON() as PMNode).content![0]!.attrs!.data).persons[0]!.role).toBe("Käufer");
    expect(plainText(node)).toBe("Personenskizze: A — § 433 I BGB → G");
    expect(toMarkdown(node)).toContain("**Personenskizze**\n\n*A = Käufer*\n- A — § 433 I BGB → G");
    const xml = await (await JSZip.loadAsync(await exportDocx(node, { title: "T" }))).file("word/document.xml")!.async("string");
    expect(xml).toContain("PERSONENSKIZZE");
    expect(xml).toContain("A — § 433 I BGB → G");
  });
});
