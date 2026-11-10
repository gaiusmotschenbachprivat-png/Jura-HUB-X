// @vitest-environment jsdom
import { Editor, generateHTML } from "@tiptap/core";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import { editorExtensions } from "../features/editor/extensions";
import { exportDocx } from "./docxExport";
import { DEFAULT_HIGHLIGHTS, highlightColor, highlightConfigOf, highlightLabel, nextFreeSlot, parseHighlightConfig, setHighlightConfig, slotOf } from "./highlights";
import type { PMNode } from "./pm";

const marked = (text: string, attrs: Record<string, unknown>): PMNode => ({ type: "text", text, marks: [{ type: "highlight", attrs }] });
const DOC: PMNode = {
  type: "doc",
  content: [{ type: "paragraph", content: [marked("alt", { color: "#fff59d" }), { type: "text", text: " " }, marked("neu", { color: "#c5f5c1", slot: "2" }), { type: "text", text: " " }, marked("ohne", { color: null })] }],
};

afterEach(() => setHighlightConfig(parseHighlightConfig(null)));

describe("Markerfarben", () => {
  it("Vorgaben, Anpassungen, eigene Plätze", () => {
    const c = parseHighlightConfig({ slots: [{ slot: "1", color: "#FFE066", label: "Definition" }, { slot: "8", color: "#ff8787", label: "Problem" }, { slot: "99", color: "#000000" }, { slot: "3", color: "kaputt" }] });
    expect(c.map((s) => s.slot)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(c[0]).toEqual({ slot: "1", color: "#ffe066", label: "Definition" });
    expect(c[2]!.color).toBe(DEFAULT_HIGHLIGHTS[2]!.color);
    // gespeichert wird nur, was abweicht
    expect(highlightConfigOf(c).slots.map((s) => s.slot)).toEqual(["1", "8"]);
    expect(nextFreeSlot(c)).toBe("9");
  });
  it("vorhandene Markierungen folgen der Farbe ihres Platzes", () => {
    expect(slotOf("#fff59d")).toBe("1");
    expect(slotOf(null)).toBe("1");
    expect(slotOf("#123456")).toBeNull();
    setHighlightConfig(parseHighlightConfig({ slots: [{ slot: "1", color: "#ffe066", label: "Definition" }] }));
    expect(highlightColor("#fff59d")).toBe("#ffe066");
    expect(highlightLabel("#fff59d")).toBe("Definition");
    expect(highlightColor("#123456")).toBe("#123456");
    expect(highlightColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(highlightColor("url(x)")).toBe("#fff59d");
  });
  it("Darstellung im Editor und Export", async () => {
    setHighlightConfig(parseHighlightConfig({ slots: [{ slot: "1", color: "#ffe066", label: "Definition" }] }));
    const html = generateHTML(DOC as never, editorExtensions());
    expect(html).toContain('<mark data-color="#fff59d" data-hl="1" title="Definition" style="--hl: #ffe066;">alt</mark>');
    expect(html).toContain('data-hl="2" title="Grün" style="--hl: #c5f5c1;">neu</mark>');
    expect(html).not.toContain("background-color");
    // Editor lädt und behält den Platz
    const el = document.createElement("div");
    const e = new Editor({ element: el, extensions: editorExtensions(), content: DOC });
    expect(JSON.stringify(e.getJSON())).toContain('"slot":"2"');
    e.commands.setTextSelection({ from: 1, to: 4 });
    e.commands.setHighlight({ color: "#b3ecff", slot: "3" } as { color: string });
    expect(e.getHTML()).toContain('data-hl="3"');
    e.destroy();
    const xml = await (await JSZip.loadAsync(await exportDocx(DOC, { title: "T" }))).file("word/document.xml")!.async("string");
    expect(xml).toContain('w:fill="FFE066"');
  });
});
