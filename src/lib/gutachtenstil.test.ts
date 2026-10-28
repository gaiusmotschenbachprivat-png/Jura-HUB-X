// @vitest-environment node
import fs from "node:fs";

import { getSchema } from "@tiptap/core";
import { Node as PMNodeClass } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import type { NewLegalChunk } from "../api/types";
import { findNormCitations, normKey } from "../ai/norms";
import { editorExtensions } from "../features/editor/extensions";
import { colorizeRange } from "../features/editor/gutachtenMark";
import { einfaerben, satzGrenzen, schrittFuer } from "./gutachtenstil";
import { GUTACHTEN_ARTEN, gutachtenDoc } from "./gutachtenVorlagen";
import { plainText, type PMNode } from "./pm";
import { TEMPLATES } from "./templates";

const law = (f: string) => (JSON.parse(fs.readFileSync(`public/gesetze/${f}`, "utf8")) as { chunks: NewLegalChunk[] }).chunks;

describe("Gutachtenstil farbig", () => {
  it("Musterlösung Körperverletzung: Sätze werden wie in einer farbigen Lösung zugeordnet", () => {
    const text =
      "A könnte B körperlich misshandelt haben. Eine körperliche Misshandlung ist jede üble, unangemessene Behandlung, die das körperliche Wohlbefinden oder die körperliche Unversehrtheit nicht nur unerheblich beeinträchtigt. Ein Faustschlag ins Gesicht ist eine üble, unangemessene Behandlung, die mit Schmerzen verbunden ist. Eine körperliche Misshandlung liegt vor.";
    expect(einfaerben(text).map((s) => s.step)).toEqual(["obersatz", "definition", "subsumtion", "ergebnis"]);
    expect(schrittFuer("A könnte sich wegen Körperverletzung gem. § 223 I StGB strafbar gemacht haben, indem er B schlug.")).toBe("obersatz");
    expect(schrittFuer("Gesundheitsschädigung ist das Hervorrufen oder Steigern eines vom Normalzustand nachteilig abweichenden Zustands.")).toBe("definition");
    expect(schrittFuer("Somit hat A den objektiven Tatbestand erfüllt.")).toBe("ergebnis");
    expect(schrittFuer("A handelte vorsätzlich.")).toBe("ergebnis");
    expect(schrittFuer("Hier hat V das Auto übergeben.")).toBe("subsumtion");
    expect(schrittFuer("Die Klage hat Erfolg, soweit sie zulässig und begründet ist.")).toBe("obersatz");
    expect(schrittFuer("Eine Streitigkeit ist öffentlich-rechtlich, wenn die streitentscheidenden Normen solche des öffentlichen Rechts sind.")).toBe("definition");
    expect(schrittFuer("Der Verwaltungsrechtsweg ist eröffnet.")).toBe("ergebnis");
  });

  it("Satzgrenzen: Abkürzungen und Normzitate trennen keinen Satz", () => {
    const t = "Dazu müsste V dem K eine Sache, z. B. ein Auto, i. V. m. § 90 BGB übergeben haben. Hier gem. Abs. 2 Nr. 1 ff. nicht. Das hat B.";
    expect(satzGrenzen(t).map(([a, b]) => t.slice(a, b))).toEqual([
      "Dazu müsste V dem K eine Sache, z. B. ein Auto, i. V. m. § 90 BGB übergeben haben.",
      "Hier gem. Abs. 2 Nr. 1 ff. nicht.",
      "Das hat B.",
    ]);
  });

  it("Einfärben im Editor: Absätze ja, Überschriften nein; bestehende Farben werden ersetzt", () => {
    const schema = getSchema(editorExtensions());
    const d = PMNodeClass.fromJSON(schema, {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "I. Tatbestand" }] },
        { type: "paragraph", content: [{ type: "text", text: "A könnte B getötet haben. Somit liegt ein Totschlag vor." }] },
        { type: "paragraph", content: [{ type: "text", text: "Hinweis: Grunddelikt vor Qualifikation.", marks: [{ type: "italic" }] }] },
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Totschlag liegt vor." }] }] }] },
      ],
    });
    const state = EditorState.create({ schema, doc: d });
    const tr = state.tr;
    expect(colorizeRange(tr, 0, tr.doc.content.size)).toBe(2);
    const json = tr.doc.toJSON() as PMNode;
    const steps = json.content![1]!.content!.map((n) => n.marks?.find((m) => m.type === "gutachten")?.attrs?.step ?? null);
    expect(steps).toEqual(["obersatz", null, "ergebnis"]);
    expect(json.content![0]!.content![0]!.marks).toBeUndefined();
    // Hinweise (kursiv) und Gliederungslisten bleiben ungefärbt
    expect(JSON.stringify(json.content!.slice(2))).not.toContain("gutachten");
  });
});

describe("Gutachten-Vorlagen nach Rechtsgebiet", () => {
  const schema = getSchema(editorExtensions());
  it("jede Vorlage ist gültig, farbig markiert und hat ihren eigenen Aufbau", () => {
    const expectText: Record<string, string[]> = {
      zivil: ["Anspruch entstanden", "Anspruch nicht untergegangen", "Anspruch durchsetzbar", "Gesamtergebnis"],
      straf: ["Tatbestand", "Objektiver Tatbestand", "Subjektiver Tatbestand", "Rechtswidrigkeit", "Schuld", "Konkurrenzen"],
      "oeff-klage": ["Zulässigkeit", "§ 40 I 1 VwGO", "Klagebefugnis", "Begründetheit", "§ 113 I 1 VwGO"],
      "oeff-vb": ["Beschwerdebefugnis", "Schutzbereich", "Eingriff", "Verfassungsrechtliche Rechtfertigung"],
      allgemein: [],
    };
    for (const a of GUTACHTEN_ARTEN) {
      const d = gutachtenDoc("Fall 1", a.id);
      expect(() => PMNodeClass.fromJSON(schema, d).check()).not.toThrow();
      const text = plainText(d);
      for (const t of expectText[a.id]!) expect(text, `${a.id}: ${t}`).toContain(t);
      const steps = new Set<string>();
      const walk = (n: PMNode) => (n.marks?.forEach((m) => m.type === "gutachten" && steps.add(String(m.attrs?.step))), n.content?.forEach(walk));
      walk(d);
      expect([...steps].sort(), a.id).toEqual(["definition", "ergebnis", "obersatz", "subsumtion"]);
    }
    expect(TEMPLATES.filter((t) => t.id.startsWith("gutachten")).length).toBe(GUTACHTEN_ARTEN.length);
  });

  it("zitierte BGB-/StGB-Normen gibt es im mitgelieferten Gesetz", () => {
    const LAWS: Record<string, NewLegalChunk[]> = { BGB: law("bgb.json"), StGB: law("stgb.json") };
    const wrong: string[] = [];
    let checked = 0;
    for (const a of GUTACHTEN_ARTEN)
      for (const c of findNormCitations(plainText(gutachtenDoc("Fall", a.id)))) {
        const chunks = LAWS[c.law];
        if (!chunks || c.sign !== "§") continue;
        checked++;
        if (!chunks.some((x) => x.norm === normKey(c) && (!c.absatz || x.absatz === null || x.absatz === c.absatz))) wrong.push(`${normKey(c)} ${c.absatz ?? ""} ${c.law}`);
      }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(5);
  });
});
