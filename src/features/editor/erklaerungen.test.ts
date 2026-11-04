// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { explanationsOf } from "../../lib/erklaerungen";
import type { PMNode } from "../../lib/pm";
import { findAnchor, findEntry, jumpTargets } from "./erklaerungen";
import { editorExtensions } from "./extensions";

const P = (text: string): PMNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const H = (text: string): PMNode => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const editorWith = (content: PMNode[]) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: editorExtensions(), content: { type: "doc", content } });
};
const posOf = (e: Editor, text: string) => {
  let at = -1;
  e.state.doc.descendants((n, p) => {
    if (at < 0 && n.isText && n.text!.includes(text)) at = p + n.text!.indexOf(text);
  });
  return at;
};

describe("Begriff erklären", () => {
  it("markiert den Begriff, legt den Bereich am Ende an und setzt die Schreibmarke dahinter", () => {
    const e = editorWith([P("Der Täter handelte mit dolus eventualis gegenüber B."), P("Weiter.")]);
    const from = posOf(e, "dolus eventualis");
    e.commands.setTextSelection({ from, to: from + "dolus eventualis".length });
    expect(e.commands.addExplanation()).toBe(true);
    e.commands.insertContent("billigendes Inkaufnehmen");
    const j = e.getJSON() as PMNode;
    const section = j.content!.find((n) => n.type === "erklaerungen")!;
    expect(section).toBeTruthy();
    expect(explanationsOf(j)).toEqual([{ term: "dolus eventualis", text: "billigendes Inkaufnehmen" }]);
    expect(JSON.stringify(j.content![0])).toContain('"type":"termRef","attrs":{"term":"dolus eventualis"}');
    // zweiter Eintrag kommt in denselben Bereich
    const from2 = posOf(e, "Weiter");
    e.commands.setTextSelection({ from: from2, to: from2 + 6 });
    e.commands.addExplanation();
    const j2 = e.getJSON() as PMNode;
    expect(j2.content!.filter((n) => n.type === "erklaerungen")).toHaveLength(1);
    expect(explanationsOf(j2).map((x) => x.term)).toEqual(["dolus eventualis", "Weiter"]);
    expect(findEntry(e.state.doc, "Dolus Eventualis")).not.toBeNull();
    e.destroy();
  });
});

describe("Sprungmarken", () => {
  it("Sprungmarke an beliebiger Stelle, Ziel bekommt eine Kennung, doppelte Kennungen werden bereinigt", () => {
    const e = editorWith([H("Einleitung"), P("Siehe unten zur Kausalität."), H("Kausalität"), P("Äquivalenztheorie …")]);
    const target = jumpTargets(e.state.doc).find((t) => t.label === "Kausalität")!;
    expect(target.heading).toBe(2);
    const from = posOf(e, "Kausalität.");
    e.commands.setTextSelection({ from, to: from + "Kausalität".length });
    expect(e.commands.setJumpLink(target.pos, target.label)).toBe(true);
    const id = e.state.doc.nodeAt(target.pos)!.attrs.anchor as string;
    expect(id).toMatch(/^s-/);
    expect(findAnchor(e.state.doc, id)).toBe(target.pos);
    expect(JSON.stringify(e.getJSON())).toContain(`"type":"jumpLink","attrs":{"target":"${id}"}`);
    // ohne Auswahl: „→ Ziel“ wird eingefügt
    e.commands.setTextSelection(posOf(e, "Äquivalenz") + 3);
    e.commands.setJumpLink(jumpTargets(e.state.doc).find((t) => t.label === "Einleitung")!.pos, "Einleitung");
    expect(e.getText()).toContain("→ Einleitung");
    // Absatz mit Kennung teilen: nur einer behält sie
    e.commands.setTextSelection(target.pos + 4);
    e.commands.splitBlock();
    const ids: string[] = [];
    e.state.doc.descendants((n) => {
      if (n.isTextblock && n.attrs.anchor) ids.push(n.attrs.anchor as string);
      return !n.isTextblock;
    });
    expect(new Set(ids).size).toBe(ids.length);
    e.destroy();
  });
});
