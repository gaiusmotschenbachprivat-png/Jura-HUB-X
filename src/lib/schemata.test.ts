// @vitest-environment node
import fs from "node:fs";

import { Node as PMNodeClass } from "@tiptap/pm/model";
import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import type { NewLegalChunk, SchemaItem } from "../api/types";
import { findNormCitations, normKey } from "../ai/norms";
import { editorExtensions } from "../features/editor/extensions";
import { BAUSTEIN_GRUPPEN, BAUSTEINE, schemaToNodes } from "./gutachten";
import { doc, plainText } from "./pm";
import { gebietOf, RECHTSGEBIETE, SCHEMA_LIBRARY, stageColor } from "./schemaLibrary";

const law = (f: string) => (JSON.parse(fs.readFileSync(`public/gesetze/${f}`, "utf8")) as { chunks: NewLegalChunk[] }).chunks;
const LAWS: Record<string, NewLegalChunk[]> = { BGB: law("bgb.json"), StGB: law("stgb.json") };
const texts = (items: SchemaItem[]): string[] => items.flatMap((i) => [i.text, i.note, ...texts(i.children)]);

describe("Schema-Bibliothek", () => {
  it("jedes Rechtsgebiet hat Schemata; Kennungen eindeutig; keine leeren Punkte", () => {
    for (const g of RECHTSGEBIETE) expect(SCHEMA_LIBRARY.filter((s) => s.gebiet === g.id).length).toBeGreaterThanOrEqual(8);
    expect(new Set(SCHEMA_LIBRARY.map((s) => s.id)).size).toBe(SCHEMA_LIBRARY.length);
    const ids = SCHEMA_LIBRARY.flatMap((s) => texts(s.items).length);
    expect(ids.every((n) => n > 0)).toBe(true);
    for (const s of SCHEMA_LIBRARY) {
      const walk = (items: SchemaItem[]) => items.forEach((i) => (expect(i.text.trim()).not.toBe(""), walk(i.children)));
      walk(s.items);
    }
  });

  it("jede zitierte BGB-/StGB-Norm (samt Absatz) gibt es im mitgelieferten Gesetz", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const s of SCHEMA_LIBRARY) {
      for (const t of [s.norm, s.notes, ...texts(s.items)]) {
        for (const c of findNormCitations(t)) {
          const chunks = LAWS[c.law];
          if (!chunks || c.sign !== "§") continue;
          checked++;
          const hits = chunks.filter((x) => x.norm === normKey(c));
          if (!hits.length || hits.every((x) => x.text === "(weggefallen)")) wrong.push(`${s.title}: ${normKey(c)} ${c.law} fehlt`);
          else if (c.absatz && hits.some((x) => x.absatz !== null) && !hits.some((x) => x.absatz === c.absatz)) wrong.push(`${s.title}: ${normKey(c)} Abs. ${c.absatz} ${c.law} fehlt`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(80);
  });

  it("Farben: Rechtsgebiet erkennen, Prüfungsstufen unterscheiden", () => {
    expect(gebietOf("Strafrecht AT")).toBe("straf");
    expect(gebietOf("BGB AT I.")).toBe("zivil");
    expect(gebietOf("Staatsorganisation")).toBe("oeff");
    expect(gebietOf("Mitschrift")).toBe(null);
    const tb = stageColor("straf", "Tatbestand");
    const rw = stageColor("straf", "Rechtswidrigkeit");
    const schuld = stageColor("straf", "Schuld");
    expect(new Set([tb, rw, schuld]).size).toBe(3);
    expect(stageColor("oeff", "Zulässigkeit")).not.toBe(stageColor("oeff", "Begründetheit (§ 113 I 1 VwGO)"));
    expect(new Set(["Anspruch entstanden", "Anspruch nicht untergegangen", "Anspruch durchsetzbar"].map((x) => stageColor("zivil", x))).size).toBe(3);
  });

  it("Einfügen in die Mitschrift: farbige Stufen, (P) ohne Lücke in der Nummerierung", () => {
    const schema = getSchema(editorExtensions());
    const s = SCHEMA_LIBRARY.find((x) => x.id === "s-242")!;
    const nodes = schemaToNodes({ title: s.title, norm: s.norm, items: s.items, gebiet: s.gebiet, notes: s.notes });
    const d = doc(...nodes);
    expect(() => PMNodeClass.fromJSON(schema, d).check()).not.toThrow();
    const t = plainText(d);
    expect(t).toMatch(/Diebstahl \(§ 242 I StGB\)[\s\S]*A\. Tatbestand[\s\S]*I\. Objektiver Tatbestand[\s\S]*1\. Fremde bewegliche Sache[\s\S]*2\. Wegnahme[\s\S]*\(P\) Gewahrsamsbruch[\s\S]*II\. Subjektiver Tatbestand[\s\S]*B\. Rechtswidrigkeit[\s\S]*C\. Schuld/);
    const json = JSON.stringify(nodes);
    expect(json).toContain(stageColor("straf", "Tatbestand"));
    expect(json).toContain(stageColor("straf", "Rechtswidrigkeit"));
    expect(json).toContain("#b4471f"); // (P)
  });

  it("Bausteine: nach Rechtsgebiet gruppiert, alle gültig", () => {
    const schema = getSchema(editorExtensions());
    for (const g of BAUSTEIN_GRUPPEN) expect(BAUSTEINE.filter((b) => b.group === g.id).length).toBeGreaterThanOrEqual(3);
    for (const bs of BAUSTEINE) {
      const d = doc(...bs.build());
      expect(() => PMNodeClass.fromJSON(schema, d).check()).not.toThrow();
      expect(plainText(d)).toContain("…");
    }
  });
});
