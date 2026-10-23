import { describe, expect, it } from "vitest";

import type { AskResult } from "./assistant";
import { scoreAnswer, summarize, type EvalQuestion } from "./evalScore";
import type { VerifyReport } from "./verify";

function result(text: string, report: Partial<VerifyReport> = {}, tools: string[] = []): AskResult {
  return {
    text,
    anonymizedText: text,
    report: {
      checks: [],
      unknownSourceIds: [],
      hasDisclaimer: true,
      ok: true,
      counts: { belegt: 2, absatz_nicht_belegt: 0, nicht_belegt: 0, existiert_nicht: 0, verweis: 0, ohne_gesetz: 0 },
      ...report,
    },
    sources: [],
    revised: false,
    stopReason: "end_turn",
    toolCalls: tools.map((name) => ({ name, input: {} })),
    sentPreview: "",
    usage: { input: 1000, output: 500, cacheRead: 0, requests: 1, costUsd: 0.014 },
    model: "claude-opus-5-5",
  };
}

const q: EvalQuestion = {
  id: "t",
  rechtsgebiet: "zivilrecht",
  aufgabe: "recherche",
  frage: "?",
  erwartete_normen: ["§ 433 Abs. 1 BGB", "§ 433 Abs. 2 BGB"],
  erwartete_stichworte: ["Übergabe", "Kaufpreis"],
};

describe("Bewertung der Evaluation", () => {
  it("volle Punktzahl bei allen Normen und Stichworten", () => {
    const s = scoreAnswer(q, result("Übergabe (§ 433 Abs. 1 S. 1 BGB) [Q1] und Kaufpreis (§ 433 II BGB) [Q2]. Ersetzt keine anwaltliche Prüfung."));
    expect(s.norm_recall).toBe(1);
    expect(s.bestanden).toBe(true);
  });
  it("fehlende Norm und Halluzination", () => {
    const s = scoreAnswer(
      q,
      result("Übergabe nach § 433 Abs. 1 BGB.", { counts: { belegt: 1, absatz_nicht_belegt: 0, nicht_belegt: 1, existiert_nicht: 1, verweis: 0, ohne_gesetz: 0 } }),
    );
    expect(s.norm_recall).toBe(0.5);
    expect(s.normen_fehlend).toEqual(["§ 433 Abs. 2 BGB"]);
    expect(s.halluzinationen).toBe(1);
    expect(s.falsche_zitate).toBe(1);
    expect(s.bestanden).toBe(false);
  });
  it("Fallen: richtige Antwort sagt, dass es das nicht gibt", () => {
    const falle: EvalQuestion = { ...q, erwartete_normen: [], erwartete_stichworte: [], falle: true };
    const ok = scoreAnswer(falle, result("§ 999 StGB existiert nicht.", { counts: { belegt: 0, absatz_nicht_belegt: 0, nicht_belegt: 0, existiert_nicht: 1, verweis: 0, ohne_gesetz: 0 } }));
    expect(ok.bestanden).toBe(true);
    const bad = scoreAnswer(falle, result("§ 999 StGB regelt die Strafbarkeit von …", { counts: { belegt: 0, absatz_nicht_belegt: 0, nicht_belegt: 0, existiert_nicht: 1, verweis: 0, ohne_gesetz: 0 } }));
    expect(bad.bestanden).toBe(false);
  });
  it("Werkzeuge und Zusammenfassung", () => {
    const tq = { ...q, erwartete_werkzeuge: ["frist_berechnen"] };
    const a = scoreAnswer(tq, result("Übergabe Kaufpreis § 433 Abs. 1 BGB § 433 Abs. 2 BGB", {}, []));
    const b = scoreAnswer(tq, result("Übergabe Kaufpreis § 433 Abs. 1 BGB § 433 Abs. 2 BGB", {}, ["frist_berechnen"]));
    expect(a.werkzeuge_ok).toBe(false);
    expect(b.bestanden).toBe(true);
    const sum = summarize([a, b]);
    expect(sum.bestanden).toBe(1);
    expect(sum.quote).toBe(0.5);
    expect(sum.kosten_usd).toBeCloseTo(0.03, 2);
  });
});
