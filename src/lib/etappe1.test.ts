// @vitest-environment jsdom
import { Editor, getSchema } from "@tiptap/core";
import { Node as PMNodeClass } from "@tiptap/pm/model";
import { afterEach, describe, expect, it } from "vitest";

import { editorExtensions } from "../features/editor/extensions";
import { buildPrintHtml, printCss } from "../features/editor/print";
import { findMatches, searchKey } from "../features/editor/searchReplace";
import { shouldRemind } from "../features/settings/BackupReminder";
import { BAUSTEINE, schemaToNodes } from "./gutachten";
import { doc, p, plainText, type PMNode } from "./pm";

const schema = getSchema(editorExtensions());
let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("Gutachtenstil", () => {
  it("alle Bausteine sind gültige Inhalte mit Platzhalter", () => {
    for (const bs of BAUSTEINE) {
      const d = doc(...bs.build());
      expect(() => PMNodeClass.fromJSON(schema, d).check()).not.toThrow();
      expect(plainText(d)).toContain("…");
    }
  });

  it("Prüfungsschema als Gliederung A. I. 1. a)", () => {
    const nodes = schemaToNodes({
      title: "Anspruch aus Kaufvertrag",
      norm: "§ 433 Abs. 2 BGB",
      items: [
        { id: "1", text: "Anspruch entstanden", note: "", children: [{ id: "2", text: "Kaufvertrag", note: "", children: [{ id: "3", text: "Angebot", note: "", children: [{ id: "4", text: "Zugang", note: "§ 130 BGB", children: [] }] }] }] },
        { id: "5", text: "Anspruch durchsetzbar", note: "", children: [] },
      ],
    });
    const d = doc(...nodes);
    expect(() => PMNodeClass.fromJSON(schema, d).check()).not.toThrow();
    const t = plainText(d);
    expect(t).toContain("Anspruch aus Kaufvertrag (§ 433 Abs. 2 BGB)");
    expect(t).toMatch(/A\. Anspruch entstanden[\s\S]*I\. Kaufvertrag[\s\S]*1\. Angebot[\s\S]*a\) Zugang[\s\S]*§ 130 BGB[\s\S]*B\. Anspruch durchsetzbar/);
    expect(nodes[1]).toMatchObject({ type: "heading", attrs: { level: 3 } });
    expect(nodes.filter((n) => n.type === "paragraph" && !n.content).length).toBe(2); // Platz zum Schreiben unter den Blättern
  });
});

describe("Suchen und Ersetzen", () => {
  const make = (content: PMNode) => {
    editor = new Editor({ element: document.createElement("div"), extensions: editorExtensions(), content });
    return editor;
  };

  it("findet über Formatierungswechsel hinweg, ohne Groß/klein", () => {
    const d = doc(
      { type: "paragraph", content: [{ type: "text", text: "Das Gestaltungs" }, { type: "text", text: "recht", marks: [{ type: "bold" }] }, { type: "text", text: " und GESTALTUNGSRECHT." }] },
      p("Kein Treffer hier."),
    );
    const e = make(d);
    expect(findMatches(e.state.doc, "gestaltungsrecht", false)).toHaveLength(2);
    expect(findMatches(e.state.doc, "Gestaltungsrecht", true)).toHaveLength(1);
  });

  it("weiterspringen, ersetzen, alle ersetzen", () => {
    const e = make(doc(p("BGB AT: § 119 BGB und § 123 BGB")));
    e.commands.setTextSelection(1);
    e.commands.setSearch("BGB");
    expect(searchKey.getState(e.state)!.matches).toHaveLength(3);
    e.commands.gotoMatch(1);
    expect(searchKey.getState(e.state)!.index).toBe(1);
    e.commands.replaceMatch("ZPO");
    expect(e.getText()).toBe("BGB AT: § 119 ZPO und § 123 BGB");
    e.commands.replaceAll("HGB");
    expect(e.getText()).toBe("HGB AT: § 119 ZPO und § 123 HGB");
    // Suche läuft weiter: keine „BGB“ mehr übrig
    expect(searchKey.getState(e.state)!.matches).toHaveLength(0);
    e.commands.clearSearch();
    expect(searchKey.getState(e.state)!.matches).toHaveLength(0);
  });
});

describe("Druckansicht", () => {
  it("Fußnoten, Inhaltsverzeichnis, Seitenumbruch, Ränder", () => {
    const d = doc(
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A. Zulässigkeit" }, { type: "footnote", attrs: { text: "Fn in Überschrift" } }] },
      { type: "paragraph", content: [{ type: "text", text: "Text" }, { type: "footnote", attrs: { text: "BVerfGE 1, 1 <3>." } }] },
      { type: "pageBreak" },
      p("Seite 2"),
    );
    const html = buildPrintHtml(d, { title: "Hausarbeit", toc: true, margins: "korrektur", style: "hausarbeit", pageNumbers: true }, () => undefined);
    expect(html).toContain('<span class="footnote">BVerfGE 1, 1 &lt;3&gt;.</span>');
    expect(html).toContain('<li class="toc-l2"><a href="#h-0">A. Zulässigkeit</a></li>');
    expect(html).toContain('class="pb"');
    expect(html).not.toContain("<script");
    const css = printCss({ title: "", toc: true, margins: "korrektur", style: "hausarbeit", pageNumbers: true });
    expect(css).toContain("margin: 2.5cm 7cm 2cm 2cm");
    expect(css).toContain("float: footnote");
    expect(css).toContain("counter(page)");
  });
});

describe("Backup-Erinnerung", () => {
  const now = Date.parse("2026-10-15T10:00:00Z");
  it("erinnert nach 7 Tagen, nicht wenn pausiert, abgeschaltet oder leer", () => {
    expect(shouldRemind({ now, lastExport: null, snoozeUntil: null, enabled: true, hasNotes: true })).toBe(true);
    expect(shouldRemind({ now, lastExport: "2026-10-10T10:00:00Z", snoozeUntil: null, enabled: true, hasNotes: true })).toBe(false);
    expect(shouldRemind({ now, lastExport: "2026-10-01T10:00:00Z", snoozeUntil: null, enabled: true, hasNotes: true })).toBe(true);
    expect(shouldRemind({ now, lastExport: null, snoozeUntil: "2026-10-16T00:00:00Z", enabled: true, hasNotes: true })).toBe(false);
    expect(shouldRemind({ now, lastExport: null, snoozeUntil: null, enabled: false, hasNotes: true })).toBe(false);
    expect(shouldRemind({ now, lastExport: null, snoozeUntil: null, enabled: true, hasNotes: false })).toBe(false);
  });
});
