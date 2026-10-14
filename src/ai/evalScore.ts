/**
 * Bewertung einer Antwort gegen eine Testfrage (eval/fragen.yaml).
 * Reine Funktionen – damit Vergleiche zwischen Prompt-/Suchvarianten reproduzierbar sind.
 */
import type { AskResult } from "./assistant";
import { findNormCitations, formatNorm, type NormCitation } from "./norms";

export interface EvalQuestion {
  id: string;
  rechtsgebiet: string;
  aufgabe: "recherche" | "vertrag" | "schriftsatz";
  frage: string;
  dokument?: string;
  erwartete_normen: string[];
  erwartete_stichworte: string[];
  erwartete_werkzeuge?: string[];
  falle?: boolean;
}

export interface EvalScore {
  id: string;
  rechtsgebiet: string;
  /** Anteil der erwarteten Normen, die zitiert wurden (0–1) */
  norm_recall: number;
  normen_fehlend: string[];
  /** zitierte Normen/Entscheidungen, die durch Quellen belegt sind */
  belegt: number;
  /** Zitate, die es gibt, die aber nicht durch abgerufene Quellen gedeckt sind */
  falsche_zitate: number;
  /** wahrscheinlich erfunden: Normen/Absätze, die es im importierten Gesetz nicht gibt, unbelegte Aktenzeichen, unbekannte [Qn] */
  halluzinationen: number;
  stichworte_quote: number;
  stichworte_fehlend: string[];
  werkzeuge_ok: boolean;
  hinweis: boolean;
  ueberarbeitet: boolean;
  bestanden: boolean;
  tokens_in: number;
  tokens_out: number;
  tokens_cache: number;
  sekunden: number;
}

const NEGATION = /(existiert nicht|gibt es nicht|nicht vorhanden|nicht enthalten|nicht in den (vorliegenden|importierten)|liegt (mir )?nicht vor|nicht belegt|keine (solche|entsprechende)|nicht auffindbar|nicht bekannt|nicht ermitteln|nicht finden)/i;

function matches(expected: NormCitation, cited: NormCitation[]): boolean {
  return cited.some(
    (c) =>
      c.sign === expected.sign &&
      c.number === expected.number &&
      c.law.toLowerCase() === expected.law.toLowerCase() &&
      (expected.absatz === null || c.absatz === expected.absatz) &&
      (expected.satz === null || c.satz === null || c.satz === expected.satz) &&
      (expected.nr === null || c.nr === null || c.nr === expected.nr),
  );
}

export function scoreAnswer(q: EvalQuestion, r: AskResult, seconds = 0): EvalScore {
  const text = r.anonymizedText;
  const cited = findNormCitations(text).filter((c) => c.law);
  const expected = q.erwartete_normen.flatMap((n) => findNormCitations(n));
  const missing = expected.filter((e) => !matches(e, cited)).map(formatNorm);
  const recall = expected.length ? (expected.length - missing.length) / expected.length : 1;
  const c = r.report.counts;
  const caseUnbelegt = r.report.checks.filter((x) => x.kind === "urteil" && x.status !== "belegt").length;
  let halluz = c.existiert_nicht + caseUnbelegt + r.report.unknownSourceIds.length;
  let falsche = c.nicht_belegt - r.report.checks.filter((x) => x.kind === "urteil" && x.status === "nicht_belegt").length + c.absatz_nicht_belegt;
  const lower = text.toLowerCase();
  const kwMissing = q.erwartete_stichworte.filter((k) => !lower.includes(k.toLowerCase()));
  const kwQuote = q.erwartete_stichworte.length ? (q.erwartete_stichworte.length - kwMissing.length) / q.erwartete_stichworte.length : 1;
  const used = new Set(r.toolCalls.map((t) => t.name));
  const toolsOk = (q.erwartete_werkzeuge ?? []).every((t) => used.has(t));
  let passed: boolean;
  if (q.falle) {
    // Die Antwort muss sagen, dass es das Erfragte nicht gibt bzw. nicht belegt ist.
    const says = NEGATION.test(text);
    if (says) {
      halluz = r.report.unknownSourceIds.length;
      falsche = 0;
    }
    passed = says && halluz === 0;
  } else {
    passed = recall === 1 && halluz === 0 && falsche === 0 && kwQuote >= 0.5 && toolsOk && r.report.hasDisclaimer !== false;
  }
  return {
    id: q.id,
    rechtsgebiet: q.rechtsgebiet,
    norm_recall: Math.round(recall * 100) / 100,
    normen_fehlend: missing,
    belegt: c.belegt,
    falsche_zitate: Math.max(0, falsche),
    halluzinationen: halluz,
    stichworte_quote: Math.round(kwQuote * 100) / 100,
    stichworte_fehlend: kwMissing,
    werkzeuge_ok: toolsOk,
    hinweis: text.includes("ersetzt keine anwaltliche Prüfung"),
    ueberarbeitet: r.revised,
    bestanden: passed,
    tokens_in: r.usage.input,
    tokens_out: r.usage.output,
    tokens_cache: r.usage.cacheRead,
    sekunden: Math.round(seconds),
  };
}

export interface EvalSummary {
  fragen: number;
  bestanden: number;
  quote: number;
  norm_recall: number;
  falsche_zitate: number;
  halluzinationen: number;
  stichworte_quote: number;
  ueberarbeitet: number;
  /** grobe Kostenschätzung in US-Dollar (Listenpreise Claude Opus 5.5) */
  kosten_usd: number;
  je_rechtsgebiet: Record<string, { fragen: number; bestanden: number }>;
}

export function summarize(scores: EvalScore[]): EvalSummary {
  const n = scores.length || 1;
  const avg = (f: (s: EvalScore) => number) => Math.round((scores.reduce((a, s) => a + f(s), 0) / n) * 100) / 100;
  const sum = (f: (s: EvalScore) => number) => scores.reduce((a, s) => a + f(s), 0);
  const by: EvalSummary["je_rechtsgebiet"] = {};
  for (const s of scores) {
    by[s.rechtsgebiet] ??= { fragen: 0, bestanden: 0 };
    by[s.rechtsgebiet]!.fragen++;
    if (s.bestanden) by[s.rechtsgebiet]!.bestanden++;
  }
  const cost = (sum((s) => s.tokens_in) * 4 + sum((s) => s.tokens_out) * 20 + sum((s) => s.tokens_cache) * 0.2) / 1_000_000;
  return {
    fragen: scores.length,
    bestanden: sum((s) => (s.bestanden ? 1 : 0)),
    quote: avg((s) => (s.bestanden ? 1 : 0)),
    norm_recall: avg((s) => s.norm_recall),
    falsche_zitate: sum((s) => s.falsche_zitate),
    halluzinationen: sum((s) => s.halluzinationen),
    stichworte_quote: avg((s) => s.stichworte_quote),
    ueberarbeitet: sum((s) => (s.ueberarbeitet ? 1 : 0)),
    kosten_usd: Math.round(cost * 100) / 100,
    je_rechtsgebiet: by,
  };
}
