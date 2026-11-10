// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { editorExtensions } from "../features/editor/extensions";
import { findTextBlock } from "../features/editor/textJump";
import { lectureDoc } from "./noteTypes";
import type { PMNode } from "./pm";
import { reviewItemsOf, reviewListText } from "./wiederholen";

const T = (text: string, bold = false) => ({ type: "text", text, ...(bold ? { marks: [{ type: "bold" }] } : {}) });
const P = (...t: (string | object)[]): PMNode => ({ type: "paragraph", content: t.map((x) => (typeof x === "string" ? T(x) : x)) as PMNode[] });
const H = (level: number, text: string): PMNode => ({ type: "heading", attrs: { level }, content: [T(text)] });
const LI = (text: string, ...sub: PMNode[]): PMNode => ({ type: "listItem", content: [P(text), ...sub] });
const UL = (...items: PMNode[]): PMNode => ({ type: "bulletList", content: items });
const TI = (text: string, checked: boolean): PMNode => ({ type: "taskItem", attrs: { checked }, content: [P(text)] });

const DOC: PMNode = {
  type: "doc",
  content: [
    H(1, "3. Vorlesung"),
    H(2, "Mitschrift"),
    UL(LI("Das gehört nicht dazu")),
    H(2, "Zum Wiederholen"),
    UL(LI("Abstraktionsprinzip", UL(LI("Trennungsprinzip"))), LI("§ 929 S. 1 BGB: ", ), LI("…")),
    H(3, "Bis zur Klausur"),
    { type: "taskList", content: [TI("Eigentumsvorbehalt", true), TI("Gutgläubiger Erwerb", false)] },
    P("Freitext: ", T("Anwartschaftsrecht", true)),
    H(2, "Begriffe"),
    UL(LI("Auch nicht")),
  ],
};

describe("Zum Wiederholen", () => {
  it("sammelt Punkte bis zur nächsten gleich hohen Überschrift", () => {
    expect(reviewItemsOf(DOC)).toEqual([
      { text: "Abstraktionsprinzip", done: false, depth: 0 },
      { text: "Trennungsprinzip", done: false, depth: 1 },
      { text: "§ 929 S. 1 BGB:", done: false, depth: 0 },
      { text: "Eigentumsvorbehalt", done: true, depth: 0 },
      { text: "Gutgläubiger Erwerb", done: false, depth: 0 },
      { text: "Freitext: Anwartschaftsrecht", done: false, depth: 0 },
    ]);
  });
  it("Vorlage ohne Einträge (nur „…“) ergibt nichts; andere Schreibweisen der Überschrift", () => {
    expect(reviewItemsOf(lectureDoc({ title: "1. Vorlesung", date: "2026-11-04" }))).toEqual([]);
    expect(reviewItemsOf({ type: "doc", content: [H(2, "Wiederholung"), UL(LI("A"))] }).map((i) => i.text)).toEqual(["A"]);
    expect(reviewItemsOf({ type: "doc", content: [H(2, "wiederholen!"), UL(LI("B"))] }).map((i) => i.text)).toEqual(["B"]);
    expect(reviewItemsOf({ type: "doc", content: [H(2, "Wiederholungsgefahr"), UL(LI("C"))] })).toEqual([]);
  });
  it("Liste als Text", () => {
    expect(reviewListText([{ title: "3. Vorlesung", items: reviewItemsOf(DOC).slice(0, 4) }])).toBe("3. Vorlesung\n  – Abstraktionsprinzip\n    – Trennungsprinzip\n  – § 929 S. 1 BGB:\n  ☑ Eigentumsvorbehalt");
  });
  it("Sprung: findet den Absatz im Bereich „Zum Wiederholen“", () => {
    const el = document.createElement("div");
    const e = new Editor({ element: el, extensions: editorExtensions(), content: { type: "doc", content: [P("Abstraktionsprinzip"), ...DOC.content!] } });
    const at = findTextBlock(e.state.doc, "Abstraktionsprinzip");
    expect(at).not.toBeNull();
    // nicht der gleichlautende Absatz ganz oben, sondern der im Bereich
    expect(at!).toBeGreaterThan(30);
    expect(e.state.doc.nodeAt(at!)?.textContent).toBe("Abstraktionsprinzip");
    expect(findTextBlock(e.state.doc, "Gibt es nicht")).toBeNull();
    e.destroy();
  });
});
