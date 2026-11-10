// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { exportDocx } from "../../lib/docxExport";
import { toMarkdown } from "../../lib/markdownExport";
import { plainText, type PMNode } from "../../lib/pm";
import { editorExtensions } from "./extensions";

const T = (text: string) => ({ type: "text", text });
const P = (text: string): PMNode => ({ type: "paragraph", content: [T(text)] });
const H = (text: string): PMNode => ({ type: "heading", attrs: { level: 2 }, content: [T(text)] });
const SV = "A ist Eigentümer eines Fahrrads. Am 10.3.2024 erklärt A die Anfechtung. Am 1.3.2024 einigt er sich mit B auf 300 €. Zwei Tage später holt B das Rad ab.";

const editorWith = (content: PMNode[]) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: editorExtensions(), content: { type: "doc", content } });
};
/** echte Taste (wie im Browser) */
const press = (e: Editor, key: string, shiftKey = false) => e.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
const timeline = (e: Editor) => (e.getJSON() as PMNode).content!.find((n) => n.type === "timeline")!;
const posOf = (e: Editor) => {
  let at = -1;
  e.state.doc.forEach((n, p) => {
    if (n.type.name === "timeline") at = p;
  });
  return at;
};
const rows = (e: Editor) => timeline(e).content!.map((x) => [x.content![0]!.content?.[0]?.text ?? "", x.content![1]!.content?.[0]?.text ?? ""]);

describe("Zeitstrahl im Editor", () => {
  it("aus dem Abschnitt „Sachverhalt“, sortieren", () => {
    const e = editorWith([H("Sachverhalt"), P(SV), H("Lösung"), P("…")]);
    e.commands.setTextSelection(3);
    expect(e.commands.timelineFromText()).toBe(true);
    const doc = e.getJSON() as PMNode;
    // hinter dem Sachverhalt, vor „Lösung“
    expect(doc.content!.map((n) => n.type)).toEqual(["heading", "paragraph", "timeline", "heading", "paragraph"]);
    expect(rows(e).map((r) => r[0])).toEqual(["Ausgangslage", "10.3.2024", "1.3.2024", "Zwei Tage später"]);
    expect(e.commands.sortTimeline()).toBe(true);
    // „Zwei Tage später“ bleibt beim 1.3.
    expect(rows(e).map((r) => r[0])).toEqual(["Ausgangslage", "1.3.2024", "Zwei Tage später", "10.3.2024"]);
    // zweiter Aufruf erkennt den vorhandenen Zeitstrahl nicht als Sachverhalt-Text
    expect(plainText(doc)).toContain("10.3.2024");
  });

  it("aus markiertem Text; ohne Zeitangaben nichts", () => {
    const e = editorWith([P(SV), P("Weiter")]);
    e.commands.setTextSelection({ from: 1, to: 60 });
    expect(e.commands.timelineFromText()).toBe(true);
    expect((e.getJSON() as PMNode).content!.map((n) => n.type)).toEqual(["paragraph", "timeline", "paragraph"]);
    const f = editorWith([P("Text ohne Sachverhalt-Überschrift")]);
    f.commands.setTextSelection(2);
    expect(f.commands.timelineFromText()).toBe(false);
  });

  it("von Hand: Zeit, Enter, Text, Enter → neuer Eintrag; leerer Eintrag + Enter verlässt", () => {
    const e = editorWith([P("Vorher")]);
    e.commands.setTextSelection(3);
    expect(e.commands.insertTimeline()).toBe(true);
    e.commands.insertContent("1.3.2024");
    press(e, "Enter");
    e.commands.insertContent("Kaufvertrag A–B");
    press(e, "Enter");
    e.commands.insertContent("14 Uhr");
    press(e, "Tab");
    e.commands.insertContent("Übergabe");
    press(e, "Enter");
    press(e, "Enter"); // Zeit leer → in den Text
    press(e, "Enter"); // leerer letzter Eintrag → raus
    e.commands.insertContent("Danach normal");
    expect(rows(e)).toEqual([
      ["1.3.2024", "Kaufvertrag A–B"],
      ["14 Uhr", "Übergabe"],
    ]);
    const doc = e.getJSON() as PMNode;
    expect(doc.content!.filter((n) => n.type === "paragraph").map((n) => n.content?.[0]?.text)).toContain("Danach normal");
    expect(doc.content!.findIndex((n) => n.content?.[0]?.text === "Danach normal")).toBeGreaterThan(doc.content!.findIndex((n) => n.type === "timeline"));
    // Shift-Tab zurück, Rücktaste am Anfang eines leeren Eintrags entfernt ihn
    e.commands.addTimelineEntry(posOf(e));
    expect(timeline(e).content!.length).toBe(3);
    press(e, "Backspace");
    expect(rows(e)).toEqual([
      ["1.3.2024", "Kaufvertrag A–B"],
      ["14 Uhr", "Übergabe"],
    ]);
    // Enter am Anfang eines Textes: leerer Eintrag davor
    press(e, "Tab", true);
    press(e, "Tab");
    expect(e.state.selection.$from.parent.textContent).toBe("Übergabe");
    e.commands.setTextSelection(e.state.selection.$from.start());
    press(e, "Enter");
    expect(rows(e)).toEqual([
      ["1.3.2024", "Kaufvertrag A–B"],
      ["", ""],
      ["14 Uhr", "Übergabe"],
    ]);
    press(e, "Backspace");
    // Sortieren behält den Eintrag mit der Schreibmarke
    e.commands.setTextSelection(e.state.selection.from);
    expect(rows(e).length).toBe(2);
    press(e, "Tab");
    press(e, "Tab");
    e.commands.insertContent(" am 2.3.");
    expect(e.state.selection.$from.parent.type.name).toBe("timelineText");
    press(e, "Tab", true);
    expect(e.state.selection.$from.parent.textContent).toBe("14 Uhr");
  });

  it("Exporte: Markdown, Word, Klartext", async () => {
    const doc: PMNode = {
      type: "doc",
      content: [
        {
          type: "timeline",
          content: [
            { type: "timelineEntry", content: [{ type: "timelineTime", content: [T("1.3.2024")] }, { type: "timelineText", content: [T("Kaufvertrag")] }] },
            { type: "timelineEntry", content: [{ type: "timelineTime" }, { type: "timelineText", content: [T("Übergabe")] }] },
          ],
        },
      ],
    };
    expect(toMarkdown(doc)).toContain("**Zeitstrahl**\n\n- **1.3.2024** – Kaufvertrag\n- **–** – Übergabe");
    expect(plainText(doc)).toBe("1.3.2024\nKaufvertrag\n\nÜbergabe");
    const xml = await (await JSZip.loadAsync(await exportDocx(doc, { title: "T" }))).file("word/document.xml")!.async("string");
    expect(xml).toContain("ZEITSTRAHL");
    expect(xml).toMatch(/<w:b\/>[\s\S]*1\.3\.2024/);
    expect(xml).toContain("Kaufvertrag");
    // Editor lädt den gespeicherten Zeitstrahl unverändert
    const e = editorWith(doc.content!);
    expect((e.getJSON() as PMNode).content![0]!.type).toBe("timeline");
    expect(rows(e)).toEqual([
      ["1.3.2024", "Kaufvertrag"],
      ["", "Übergabe"],
    ]);
  });
});
