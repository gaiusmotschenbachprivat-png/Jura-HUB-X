import { getSchema } from "@tiptap/core";
import JSZip from "jszip";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";

import { editorExtensions } from "../features/editor/extensions";
import { exportDocx } from "./docxExport";
import { markdownToHtml } from "./docxImport";
import { formatBytes, highlightHtml } from "./format";
import { toMarkdown } from "./markdownExport";
import { b, doc, h, ol, p, plainText, quote, table, tasks, ul, type PMNode } from "./pm";
import { TEMPLATES } from "./templates";
import { ancestors, buildTree, isDescendant, positionBetween } from "./tree";
import type { StudyNode } from "../api/types";
import { Node as PMNodeClass } from "@tiptap/pm/model";

const sample: PMNode = doc(
  h(1, "Anfechtung"),
  p("Die ", b("Anfechtung"), " vernichtet die Willenserklärung rückwirkend."),
  ul("Irrtum § 119 BGB", [p("Täuschung"), ul("arglistig")]),
  ol("Anfechtungserklärung", "Anfechtungsgrund", "Frist"),
  tasks("Fall 3 lösen"),
  quote(p("Definition: Irrtum ist …")),
  table(["Norm", "Frist"], [["§ 121 BGB", "unverzüglich"], ["§ 124 BGB", "ein Jahr"]]),
);

describe("Notizformat", () => {
  it("leitet reinen Text für Suche ab", () => {
    const t = plainText(sample);
    expect(t).toContain("Anfechtung");
    expect(t).toContain("§ 121 BGB");
    expect(t).toContain("Fall 3 lösen");
  });

  it("alle Vorlagen sind gültig im Editor-Schema", () => {
    const schema = getSchema(editorExtensions());
    for (const tpl of TEMPLATES) {
      const json = tpl.build("Titel");
      expect(() => PMNodeClass.fromJSON(schema, json).check(), tpl.id).not.toThrow();
    }
    expect(() => PMNodeClass.fromJSON(schema, sample).check()).not.toThrow();
  });
});

describe("DOCX-Export", () => {
  it("erzeugt eine gültige Word-Datei mit Struktur", async () => {
    const bytes = await exportDocx(sample, { title: "Anfechtung" });
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Anfechtung");
    expect(xml).toContain("Heading1");
    expect(xml).toContain("w:tbl");
    expect(xml).toContain("☐");
    expect(zip.file("word/numbering.xml")).toBeTruthy();
  });

  it("lässt sich mit einem DOCX-Leser wieder öffnen (Rundweg)", async () => {
    const bytes = await exportDocx(sample, { title: "Anfechtung" });
    const res = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
    expect(res.value).toMatch(/<h1>Anfechtung<\/h1>/);
    expect(res.value).toContain("<strong>Anfechtung</strong>");
    expect(res.value).toContain("<table>");
    expect(res.value).toMatch(/<ol>.*Anfechtungserklärung/);
    expect(res.value).toMatch(/<ul>.*Irrtum § 119 BGB/);
  });

  it("exportiert leere Notizen", async () => {
    const bytes = await exportDocx(doc(), { title: "leer" });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

describe("Markdown", () => {
  it("exportiert Überschriften, Listen, Tabellen und Checklisten", () => {
    const md = toMarkdown(sample);
    expect(md).toContain("# Anfechtung");
    expect(md).toContain("**Anfechtung**");
    expect(md).toContain("- Irrtum § 119 BGB");
    expect(md).toContain("1. Anfechtungserklärung");
    expect(md).toContain("- [ ] Fall 3 lösen");
    expect(md).toContain("| Norm | Frist |");
  });

  it("importiert einfaches Markdown", () => {
    const html = markdownToHtml("# Titel\n\n- a\n- b\n\nText mit **fett** <script>x</script>");
    expect(html).toContain("<h1>Titel</h1>");
    expect(html).toContain("<ul><li><p>a</p></li><li><p>b</p></li></ul>");
    expect(html).toContain("<strong>fett</strong>");
    expect(html).not.toContain("<script>");
  });
});

describe("Formatierung", () => {
  it("Suchmarkierungen werden sicher in HTML umgesetzt", () => {
    expect(highlightHtml("<b>\u0002Treffer\u0003</b>")).toBe("&lt;b&gt;<mark>Treffer</mark>&lt;/b&gt;");
  });
  it("Dateigrößen", () => {
    expect(formatBytes(1536)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5,0 MB");
  });
});

describe("Strukturbaum", () => {
  const n = (id: string, parent: string | null, pos: number, archived = false): StudyNode => ({
    id,
    area_id: "a",
    parent_id: parent,
    kind: "topic",
    title: id,
    position: pos,
    meta: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    archived_at: archived ? "x" : null,
    deleted_at: null,
  });
  const nodes = [n("ws", null, 1), n("bgb", "ws", 2), n("t1", "bgb", 1), n("alt", null, 0, true), n("waise", "fehlt", 5)];

  it("baut den Baum, sortiert und blendet Archiviertes aus", () => {
    const t = buildTree(nodes);
    expect(t.map((x) => x.node.id)).toEqual(["ws", "waise"]);
    expect(t[0]!.children[0]!.children[0]!.node.id).toBe("t1");
    expect(buildTree(nodes, { showArchived: true })[0]!.node.id).toBe("alt");
  });

  it("berechnet Positionen und Vorfahren", () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(undefined, 1024)).toBe(0);
    expect(ancestors(nodes, "t1")).toEqual(["bgb", "ws"]);
    expect(isDescendant(nodes, "t1", "ws")).toBe(true);
    expect(isDescendant(nodes, "ws", "t1")).toBe(false);
  });
});
