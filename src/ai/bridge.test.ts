// @vitest-environment jsdom
/**
 * Claude-App-Brücke und Kostenbremse: Anfrage zusammenstellen, eingefügte
 * Antwort prüfen und weiterverwenden – ohne Netzwerk.
 */
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";

import { createLegalMock } from "../api/mockLegal";
import { LegalAssistant } from "./assistant";
import { BRIDGE_MODEL, bridgeStudyPrompt, extractJson } from "./bridge";
import type { LlmClient } from "./client";
import { DISCLAIMER } from "./config";
import { addToSpent, budgetExceeded, spentFrom } from "./cost";
import { Anonymizer } from "./privacy/anonymize";
import { cardsInput, parseCards, parseCase } from "./study";

async function store() {
  const s = createLegalMock();
  await s.legalSourceSave({ kind: "gesetz", title: "Mustergesetz", abbreviation: "MustG", version: "Testfassung" }, [
    { norm: "§ 1", absatz: 1, heading: "Pflichten", text: "(1) Der Verkäufer einer Mustersache hat sie zu übergeben." },
    { norm: "§ 1", absatz: 2, heading: "Pflichten", text: "(2) Der Käufer hat den Musterpreis zu zahlen." },
  ]);
  return s;
}

describe("Claude-App-Brücke", () => {
  it("stellt die Anfrage mit Quellen anonymisiert zusammen, ohne die API zu nutzen", async () => {
    const llm: LlmClient = {
      create: async () => {
        throw new Error("API darf nicht aufgerufen werden");
      },
    };
    const a = new LegalAssistant({ llm, store: await store(), task: "recherche" });
    const { prompt, userText } = await a.prepareExternal("Muss Herr Müller als Käufer der Mustersache den Musterpreis zahlen?");
    expect(prompt).not.toContain("Müller");
    expect(prompt).toContain("[PERSON_1]");
    expect(prompt).toContain("<quellen>");
    expect(prompt).toMatch(/\[Q\d\] \(gesetz\) § 1/);
    expect(prompt).toContain("Gutachtenstil");
    expect(prompt).toContain(DISCLAIMER);
    expect(prompt).not.toContain("norm_abrufen"); // keine Werkzeuge in der Claude-App
    expect(prompt.endsWith(userText)).toBe(true);
  });

  it("prüft die eingefügte Antwort, setzt Namen wieder ein und nimmt sie in den Verlauf auf", async () => {
    const calls: MessageCreateParamsNonStreaming[] = [];
    const llm: LlmClient = {
      create: async (p) => {
        calls.push(JSON.parse(JSON.stringify(p)));
        return {
          id: "m",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [{ type: "text", text: `Ja.\n\n${DISCLAIMER}`, citations: null }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        } as unknown as BetaMessage;
      },
    };
    const a = new LegalAssistant({ llm, store: await store(), task: "recherche" });
    const { userText } = await a.prepareExternal("Muss Herr Müller zahlen?");
    const r = await a.acceptExternal(userText, "Herr [PERSON_1] muss zahlen (§ 1 Abs. 2 MustG) [Q2]. Nach § 99 MustG gilt nichts anderes.");
    expect(r.model).toBe(BRIDGE_MODEL);
    expect(r.usage.costUsd).toBe(0);
    expect(r.text).toContain("Herr Müller muss zahlen");
    expect(r.text).toContain(DISCLAIMER);
    // § 1 Abs. 2 ist belegt, § 99 gibt es nicht
    const byLabel = Object.fromEntries(r.report.checks.map((c) => [c.label, c.status]));
    expect(byLabel).toEqual({ "§ 1 Abs. 2 MustG": "belegt", "§ 99 MustG": "existiert_nicht" });
    // Rückfrage über die API kennt die Antwort aus der Claude-App
    await a.ask("Und wann?");
    const sent = JSON.stringify(calls[0]!.messages);
    expect(sent).toContain("[PERSON_1] muss zahlen");
    expect(sent).not.toContain("Müller");
  });

  it("Lernhilfen: JSON-Anweisung, Antwort mit Codeblock und Text wird gelesen", () => {
    const an = new Anonymizer();
    const prompt = bridgeStudyPrompt("karteikarten", cardsInput(an, "Anfechtung", "Herr Müller lernt § 119 BGB."));
    expect(prompt).toContain('"karten"');
    expect(prompt).toContain("[PERSON_1]");
    const answer = 'Hier sind deine Karten:\n\n```json\n{"karten": [{"art": "norm", "vorderseite": "Was regelt § 119 BGB?", "rueckseite": "Anfechtung wegen Irrtums – wie bei [PERSON_1]."}]}\n```\nViel Erfolg!';
    const cards = parseCards(extractJson(answer), an);
    expect(cards).toEqual([{ kind: "norm", front: "Was regelt § 119 BGB?", back: "Anfechtung wegen Irrtums – wie bei Müller." }]);
    expect(() => extractJson("Leider kann ich das nicht.")).toThrow(/kein JSON/);
    expect(() => parseCase(extractJson('{"titel": "x"}'), an)).toThrow(/Übungsfall/);
  });
});

describe("Monatsbudget", () => {
  it("zählt je Monat und stoppt bei erreichtem Budget", () => {
    const okt = new Date(2026, 9, 28);
    let s = spentFrom(undefined, okt);
    s = addToSpent(s, 4, 10); // 4 $ ≈ 3,60 €
    expect(budgetExceeded(s, 5)).toBeNull();
    s = addToSpent(s, 2, 3); // 6 $ ≈ 5,40 €
    expect(budgetExceeded(s, 5)).toMatch(/Claude-App/);
    expect(budgetExceeded(s, 0)).toBeNull(); // kein Budget gesetzt
    // neuer Monat: Monatszähler beginnt bei 0, Gesamtsumme bleibt
    const nov = spentFrom(JSON.parse(JSON.stringify(s)), new Date(2026, 10, 1));
    expect(nov.monthUsd).toBe(0);
    expect(nov.usd).toBe(6);
    expect(budgetExceeded(nov, 5)).toBeNull();
  });
});
