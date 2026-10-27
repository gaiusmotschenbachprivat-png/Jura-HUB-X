// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { bestQuery } from "../features/editor/FindBar";
import { editorExtensions } from "../features/editor/extensions";
import { findMatches, matchContexts, searchKey } from "../features/editor/searchReplace";
import { doc, h, p } from "./pm";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const lecture = () =>
  doc(
    h(2, "1. Willenserklärung"),
    p("Die Willenserklärung besteht aus einem objektiven und einem subjektiven Tatbestand."),
    h(2, "2. Zugang"),
    p("Eine empfangsbedürftige Willenserklärung wird mit Zugang wirksam (§ 130 I 1 BGB). Zugang setzt voraus, dass sie in den Machtbereich gelangt."),
  );

describe("Stichwortsuche in der Mitschrift", () => {
  it("Trefferliste mit Ausschnitt und Abschnitt", () => {
    editor = new Editor({ extensions: editorExtensions(), content: lecture() });
    const m = findMatches(editor.state.doc, "zugang", false);
    expect(m).toHaveLength(3);
    const ctx = matchContexts(editor.state.doc, m, 20);
    expect(ctx[0]).toMatchObject({ heading: "", hit: "Zugang" }); // in der Überschrift selbst
    expect(ctx[1]!.heading).toBe("2. Zugang");
    expect(ctx[1]!.hit).toBe("Zugang");
    expect(ctx[1]!.before).toBe("…serklärung wird mit ");
    expect(ctx[1]!.after).toMatch(/^ wirksam/);
    expect(ctx[2]!.before.startsWith("…")).toBe(true);
  });

  it("zu einem Treffer der Liste springen", () => {
    editor = new Editor({ extensions: editorExtensions(), content: lecture() });
    editor.commands.setSearch("Willenserklärung");
    editor.commands.gotoMatchIndex(2);
    const s = searchKey.getState(editor.state)!;
    expect(s.index).toBe(2);
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe("Willenserklärung");
    expect(editor.commands.gotoMatchIndex(9)).toBe(false);
  });

  it("aus der globalen Suche: passendes Stichwort wählen", () => {
    editor = new Editor({ extensions: editorExtensions(), content: lecture() });
    expect(bestQuery(editor.state.doc, "Zugang")).toBe("Zugang");
    // mehrere Wörter, die nicht direkt nebeneinander stehen → längstes vorkommendes Wort
    expect(bestQuery(editor.state.doc, "Zugang Machtbereich Empfänger")).toBe("Machtbereich");
    expect(bestQuery(editor.state.doc, "„objektiven und“")).toBe("objektiven und");
  });
});
