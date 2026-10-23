// @vitest-environment jsdom
/**
 * Ablauftests mit einem simulierten Claude (kein Netzwerk, kein API-Schlüssel).
 * Testdaten sind ein erfundenes Mustergesetz, kein echter Gesetzestext.
 */
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";

import { createLegalMock } from "../api/mockLegal";
import { LegalAssistant, textOf } from "./assistant";
import type { LlmClient } from "./client";
import { DISCLAIMER } from "./config";
import { Anonymizer } from "./privacy/anonymize";
import { verifyAnswer } from "./verify";
import { SourceRegistry } from "./sources/registry";

type Block = BetaMessage["content"][number];

function msg(content: unknown[], stop: BetaMessage["stop_reason"]): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: content as Block[],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
  } as unknown as BetaMessage;
}
const text = (t: string) => ({ type: "text", text: t, citations: null });
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });

class FakeLlm implements LlmClient {
  calls: MessageCreateParamsNonStreaming[] = [];
  constructor(private script: ((p: MessageCreateParamsNonStreaming) => BetaMessage)[]) {}
  async create(p: MessageCreateParamsNonStreaming) {
    // Kopie des Verlaufs zum Zeitpunkt des Aufrufs festhalten
    this.calls.push(JSON.parse(JSON.stringify(p)));
    const next = this.script.shift();
    if (!next) throw new Error("kein weiterer Schritt im Skript");
    return next(p);
  }
}

async function store() {
  const s = createLegalMock();
  await s.legalSourceSave({ kind: "gesetz", title: "Mustergesetz", abbreviation: "MustG", version: "Testfassung" }, [
    { norm: "§ 1", absatz: 1, heading: "Pflichten", text: "(1) Der Verkäufer einer Mustersache hat sie zu übergeben." },
    { norm: "§ 1", absatz: 2, heading: "Pflichten", text: "(2) Der Käufer hat den Musterpreis zu zahlen." },
    { norm: "§ 2", absatz: null, heading: "Frist", text: "Die Musterfrist beträgt zwei Wochen." },
  ]);
  return s;
}

describe("Juristischer Assistent – Ablauf", () => {
  it("ruft Quellen ab, nutzt Werkzeuge, prüft Zitate und anonymisiert", async () => {
    const s = await store();
    const llm = new FakeLlm([
      () => msg([text("Ich hole die Fristnorm."), toolUse("tu1", "norm_abrufen", { gesetz: "MustG", norm: "§ 2", absatz: 0 })], "tool_use"),
      () =>
        msg(
          [
            text(
              "Herr [PERSON_1] muss als Käufer zahlen (§ 1 Abs. 2 MustG) [Q2]. Die Frist beträgt zwei Wochen (§ 2 MustG) [Q3].\n\n" + DISCLAIMER,
            ),
          ],
          "end_turn",
        ),
    ]);
    const a = new LegalAssistant({ llm, store: s, task: "recherche" });
    const r = await a.ask("Muss Herr Müller als Käufer der Mustersache zahlen? Welche Frist gilt?");
    // Anfrage: anonymisiert, mit Quellen, System-Prompt, Werkzeugen, Ausweichmodell
    const first = llm.calls[0]!;
    const sent = JSON.stringify(first.messages);
    expect(sent).not.toContain("Müller");
    expect(sent).toContain("<quellen>");
    expect(first.model).toBe("claude-opus-5-5");
    expect((first as unknown as { fallbacks: string }).fallbacks).toBe("default");
    expect(first.tools?.map((t) => (t as { name: string }).name)).toContain("norm_abrufen");
    // Werkzeugergebnis ging als tool_result zurück
    const second = JSON.stringify(llm.calls[1]!.messages);
    expect(second).toContain('"tool_use_id":"tu1"');
    expect(second).toContain("Musterfrist");
    // Ergebnis
    expect(r.text).toContain("Herr Müller");
    expect(r.report.ok).toBe(true);
    expect(r.report.counts.belegt).toBe(2);
    expect(r.revised).toBe(false);
    expect(r.toolCalls).toEqual([{ name: "norm_abrufen", input: { gesetz: "MustG", norm: "§ 2", absatz: 0 } }]);
    expect(r.usage.requests).toBe(2);
  });

  it("erkennt nicht belegte und erfundene Zitate und fordert eine Überarbeitung an", async () => {
    const s = await store();
    const llm = new FakeLlm([
      () => msg([text("Nach § 1 Abs. 7 MustG und § 99 MustG sowie BGH VIII ZR 1/20 gilt … [Q9]")], "end_turn"),
      (p) => {
        const last = p.messages[p.messages.length - 1]!;
        expect(String(last.content)).toContain("Automatische Prüfung der Zitate");
        return msg([text("Der Käufer muss zahlen (§ 1 Abs. 2 MustG) [Q2]. " + DISCLAIMER)], "end_turn");
      },
    ]);
    const a = new LegalAssistant({ llm, store: s, task: "recherche" });
    const r = await a.ask("Was muss der Käufer der Mustersache tun?");
    expect(r.revised).toBe(true);
    expect(r.report.ok).toBe(true);
    // Verlauf nur angehängt: Erst- und Überarbeitungsantwort sind enthalten
    expect(a.history.filter((m) => m.role === "assistant")).toHaveLength(2);
  });

  it("Prüfbericht unterscheidet die Fälle", async () => {
    const s = await store();
    const reg = new SourceRegistry();
    reg.register(await s.legalNorm("MustG", "§ 1", null));
    const rep = await verifyAnswer("§ 1 Abs. 2 MustG; § 1 Abs. 7 MustG; § 2 MustG; § 99 MustG; § 433 BGB; § 5; VIII ZR 1/20 [Q9]", reg, s);
    const by = Object.fromEntries(rep.checks.map((c) => [c.label, c.status]));
    expect(by["§ 1 Abs. 2 MustG"]).toBe("belegt");
    expect(by["§ 1 Abs. 7 MustG"]).toBe("existiert_nicht");
    expect(by["§ 2 MustG"]).toBe("nicht_belegt");
    expect(by["§ 99 MustG"]).toBe("existiert_nicht");
    expect(by["§ 433 BGB"]).toBe("nicht_belegt");
    expect(by["§ 5"]).toBe("ohne_gesetz");
    expect(by["VIII ZR 1/20"]).toBe("nicht_belegt");
    expect(rep.unknownSourceIds).toEqual(["Q9"]);
    expect(rep.ok).toBe(false);
  });

  it("behandelt Ablehnungen und ergänzt den Hinweis", async () => {
    const s = await store();
    const llm = new FakeLlm([() => msg([], "refusal")]);
    const r = await new LegalAssistant({ llm, store: s, task: "vertrag" }).ask("Prüfe den Vertrag.", "§ 1 Der Käufer zahlt.");
    expect(r.text).toContain("abgelehnt");
    expect(r.text).toContain(DISCLAIMER);
  });

  it("eigene Dokumente nur mit Freigabe und anonymisiert", async () => {
    const s = await store();
    const anonymizer = new Anonymizer();
    anonymizer.anonymize("Frau Schmidt");
    const llm = new FakeLlm([
      () => msg([toolUse("tu1", "dokumente_suchen", { anfrage: "Mustersache" })], "tool_use"),
      (p) => {
        const res = JSON.stringify(p.messages[p.messages.length - 1]);
        expect(res).not.toContain("Schmidt");
        expect(res).toContain("[PERSON_1]");
        return msg([text("Fertig. " + DISCLAIMER)], "end_turn");
      },
    ]);
    const a = new LegalAssistant({
      llm,
      store: s,
      task: "recherche",
      anonymizer,
      ownDocuments: async () => [{ title: "Mitschrift", path: "BGB AT", snippet: "Frau Schmidt kaufte die Mustersache." }],
    });
    await a.ask("Was steht in meinen Notizen zur Mustersache?");
    const noDocs = new LegalAssistant({ llm: new FakeLlm([]), store: s, task: "recherche" });
    expect(JSON.stringify((noDocs as unknown as { tools: { definition: { name: string } }[] }).tools.map((t) => t.definition.name))).not.toContain(
      "dokumente_suchen",
    );
  });

  it("textOf liest nur Textblöcke", () => {
    expect(textOf(msg([{ type: "thinking", thinking: "", signature: "x" }, text("A"), text("B")], "end_turn"))).toBe("AB");
  });

  it("setzt eine gespeicherte Unterhaltung fort (Verlauf, Quellen, Platzhalter)", async () => {
    const s = await store();
    const llm1 = new FakeLlm([() => msg([{ type: "thinking", thinking: "…", signature: "sig" }, text("Herr [PERSON_1] muss zahlen (§ 1 Abs. 2 MustG) [Q2].\n\n" + DISCLAIMER)], "end_turn")]);
    const a = new LegalAssistant({ llm: llm1, store: s, task: "recherche" });
    await a.ask("Muss Herr Müller als Käufer der Mustersache zahlen?");
    // wie beim Speichern: über JSON
    const saved = JSON.parse(JSON.stringify(a.snapshot()));
    expect(JSON.stringify(saved.messages)).not.toContain("Müller");

    const llm2 = new FakeLlm([
      (p) => {
        // früherer Verlauf samt Denkblock geht mit, neue Frage hängt hinten an
        expect(p.messages).toHaveLength(3);
        expect(JSON.stringify(p.messages[1])).toContain('"signature":"sig"');
        const last = JSON.stringify(p.messages[2]);
        expect(last).toContain("[PERSON_1]");
        expect(last).not.toContain("Müller");
        return msg([text("Ja, [PERSON_1] schuldet den Musterpreis [Q2].\n\n" + DISCLAIMER)], "end_turn");
      },
    ]);
    const b = new LegalAssistant({ llm: llm2, store: s, task: "recherche", restore: saved });
    const r = await b.ask("Und was gilt, wenn Herr Müller nicht zahlt?");
    expect(r.text).toContain("Ja, Müller schuldet");
    // Kennungen bleiben gleich, keine doppelten Quellen
    expect(r.sources.filter((x) => x.id === "Q2")).toHaveLength(1);
    expect(r.report.unknownSourceIds).toEqual([]);
  });

  it("lässt den Verlauf nach einem Abbruch unverändert", async () => {
    const s = await store();
    const llm = new FakeLlm([
      () => msg([text("Erste Antwort. " + DISCLAIMER)], "end_turn"),
      () => msg([toolUse("tu1", "norm_abrufen", { gesetz: "MustG", norm: "§ 2" })], "tool_use"),
      // danach: kein Schritt mehr → Fehler wie bei einem Netzabbruch
    ]);
    const a = new LegalAssistant({ llm, store: s, task: "recherche" });
    await a.ask("Erste Frage");
    expect(a.history).toHaveLength(2);
    await expect(a.ask("Zweite Frage")).rejects.toThrow();
    expect(a.history).toHaveLength(2);
    // ein gespeicherter Verlauf mit offenem Werkzeugaufruf wird bis zur letzten Antwort gekürzt
    const broken = { ...a.snapshot(), messages: [...a.history, { role: "user" as const, content: "x" }, { role: "assistant" as const, content: [toolUse("t", "norm_abrufen", {})] }] };
    expect(new LegalAssistant({ llm, store: s, task: "recherche", restore: broken as never }).history).toHaveLength(2);
  });

  it("Zitatprüfung: im Wortlaut einer abgerufenen Norm genannte Vorschriften sind Verweise", async () => {
    const s = createLegalMock();
    await s.legalSourceSave({ kind: "gesetz", title: "Mustergesetz", abbreviation: "MustG" }, [
      { norm: "§ 5", absatz: 1, heading: "Ruhen", text: "(1) Die Frist ruht bei Taten nach den §§ 10 bis 12a, 14, 20 Absatz 1 Satz 1 Nummer 3, auch in Verbindung mit Absatz 2, 31 und nach § 40." },
      { norm: "§ 10", absatz: null, heading: "A", text: "Text A." },
      { norm: "§ 12a", absatz: null, heading: "B", text: "Text B." },
      { norm: "§ 31", absatz: null, heading: "C", text: "Text C." },
      { norm: "§ 40", absatz: null, heading: "D", text: "Text D." },
      { norm: "§ 41", absatz: null, heading: "E", text: "Text E." },
      { norm: "§ 3", absatz: null, heading: "F", text: "Text F." },
    ]);
    const reg = new SourceRegistry();
    reg.register(await s.legalNorm("MustG", "§ 5", null));
    const r = await verifyAnswer("Genannt sind §§ 10, 12a, 31 und 40 MustG (§ 5 Abs. 1 MustG). Dazu § 41 MustG und § 3 MustG.", reg, s);
    const by = Object.fromEntries(r.checks.map((c) => [c.label, c.status]));
    expect(by["§ 5 Abs. 1 MustG"]).toBe("belegt");
    expect(by["§ 12a MustG"]).toBe("verweis");
    expect(by["§ 31 MustG"]).toBe("verweis");
    expect(by["§ 40 MustG"]).toBe("verweis");
    expect(by["§ 41 MustG"]).toBe("nicht_belegt");
    expect(by["§ 3 MustG"]).toBe("nicht_belegt");
    expect(r.ok).toBe(false);
  });
});
