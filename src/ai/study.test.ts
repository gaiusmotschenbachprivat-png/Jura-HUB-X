// @vitest-environment jsdom
import { getSchema } from "@tiptap/core";
import { Node as PMNodeClass } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { caseDoc, solutionText } from "../features/assistant/StudyTools";
import { editorExtensions } from "../features/editor/extensions";
import type { LlmClient } from "./client";
import { MODEL } from "./config";
import { Anonymizer } from "./privacy/anonymize";
import { createCase, prepareNotes, reviewSolution, suggestCards } from "./study";

type Params = Parameters<LlmClient["create"]>[0];
function fake(reply: string, stop = "end_turn") {
  const calls: Params[] = [];
  const llm: LlmClient = {
    create: async (p) => {
      calls.push(p);
      return { id: "m", type: "message", role: "assistant", model: MODEL, content: [{ type: "text", text: reply, citations: null }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as never;
    },
  };
  return { llm, calls };
}
const userText = (p: Params) => String(p.messages[0]!.content);
const systemText = (p: Params) => (p.system as { text: string }[]).map((s) => s.text).join("\n");

describe("KI-Lernhilfen", () => {
  it("Mitschrift aufbereiten: anonymisiert, Aufgaben-Prompt, Rückübersetzung", async () => {
    const { llm, calls } = fake("# Lernskript: Anfechtung\n\nHerr [PERSON_1] erklärte § 119 BGB.");
    const r = await prepareNotes({ llm, anonymizer: new Anonymizer() }, "3. Vorlesung", "Herr Müller erklärte die Anfechtung nach § 119 BGB ausführlich.");
    expect(userText(calls[0]!)).not.toContain("Müller");
    expect(userText(calls[0]!)).toContain("[PERSON_1]");
    expect(systemText(calls[0]!)).toContain("Lernskript");
    expect(systemText(calls[0]!)).toContain("Erfinde keine Normen");
    // Standard „Automatisch“: Lernskript mit Claude Haiku 5.5
    expect(calls[0]!.model).toBe("claude-haiku-5-5");
    expect(calls[0]!.output_config).toEqual({ effort: "medium" });
    expect(r.value).toContain("Herr Müller erklärte");
  });

  it("Karteikarten: JSON-Schema, Auswertung, ungültige Einträge raus", async () => {
    const { llm, calls } = fake(JSON.stringify({ karten: [{ art: "definition", vorderseite: "Willenserklärung", rueckseite: "Äußerung eines Rechtsfolgewillens." }, { art: "quatsch", vorderseite: "Frage?", rueckseite: "Antwort." }, { art: "frage", vorderseite: "", rueckseite: "x" }] }));
    const r = await suggestCards({ llm }, "BGB AT", "Stoff …");
    expect((calls[0]!.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(r.value).toEqual([
      { kind: "definition", front: "Willenserklärung", back: "Äußerung eines Rechtsfolgewillens." },
      { kind: "frage", front: "Frage?", back: "Antwort." },
    ]);
  });

  it("Übungsfall und Besprechung", async () => {
    const c = fake(JSON.stringify({ titel: "Der Weinkauf", sachverhalt: "A verkauft B Wein.\nB zahlt nicht.", fallfrage: "Hat A einen Anspruch?", bearbeitungshinweis: "Alle Fragen sind zu prüfen.", loesungsskizze: "A. § 433 II BGB" }));
    const r = await createCase({ llm: c.llm }, "BGB AT", "Stoff", "examen");
    expect(userText(c.calls[0]!)).toContain("Examensniveau");
    expect(r.value).toMatchObject({ title: "Der Weinkauf", question: "Hat A einen Anspruch?", sketch: "A. § 433 II BGB" });
    const d = caseDoc(r.value);
    expect(() => PMNodeClass.fromJSON(getSchema(editorExtensions()), d).check()).not.toThrow();

    const k = fake("## Gesamteindruck\nGut.");
    const fb = await reviewSolution({ llm: k.llm }, r.value, "A hat einen Anspruch aus § 433 Abs. 2 BGB.");
    expect(userText(k.calls[0]!)).toContain("<loesungsskizze_nur_fuer_dich>");
    expect(userText(k.calls[0]!)).toContain("<loesung>\nA hat einen Anspruch");
    expect(fb.value).toContain("Gesamteindruck");
  });

  it("Ablehnung und abgeschnittene Antwort werden gemeldet", async () => {
    await expect(prepareNotes({ llm: fake("", "refusal").llm }, "x", "y")).rejects.toThrow("abgelehnt");
    await expect(prepareNotes({ llm: fake("…", "max_tokens").llm }, "x", "y")).rejects.toThrow("zu lang");
  });

  it("Lösungstext wird unter „Lösung“ gefunden", () => {
    expect(solutionText("Sachverhalt\nA …\nLösung\nMeine Lösung.\nRückmeldung (KI, ungeprüft)\nalt")).toBe("Meine Lösung.");
    expect(solutionText("Nur Text")).toBe("Nur Text");
  });
});
