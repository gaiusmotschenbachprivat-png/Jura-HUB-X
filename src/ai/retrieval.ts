/**
 * Abruf der relevantesten Quellenabschnitte für eine Frage:
 * 1. Normen, die in der Frage genannt sind („§ 433 BGB“), werden vollständig geladen.
 * 2. Dazu kommen die besten Treffer der Volltextsuche (BM25) über alle Quellen.
 *
 * Die Suche ist austauschbar (`Retriever`), z. B. für eine spätere semantische
 * Suche mit einem lokalen Modell.
 */
import type { LegalHit, LegalKind } from "../api/types";
import { findNormCitations, normKey } from "./norms";

export interface LegalStore {
  legalSearch(terms: string[], kinds: LegalKind[] | null, limit: number): Promise<LegalHit[]>;
  legalNorm(abbreviation: string, norm: string, absatz: number | null): Promise<LegalHit[]>;
}

export interface Retriever {
  retrieve(question: string, opts?: { limit?: number; kinds?: LegalKind[] | null }): Promise<LegalHit[]>;
}

const STOP = new Set(
  (
    "der die das den dem des ein eine einer eines einem einen und oder aber als auch auf aus bei bis durch für gegen in im ins ist sind war waren " +
    "wird werden wurde wurden mit nach nicht noch nur ob ohne seine sein ihr ihre über um unter von vor wie was wer wann wo zu zum zur sich " +
    "kann können muss müssen darf dürfen soll sollen hat haben hatte es er sie wir ich du man dass da so wenn welche welcher welches dieser " +
    "diese dieses jener hier dort sehr mehr weniger ja nein bzw vgl etc gibt frage fall prüfe prüfen bitte erkläre erklären"
  ).split(" "),
);

/** Grobe Grundform: häufige Endungen entfernen, damit der Präfixvergleich mehr findet. */
export function stem(w: string): string {
  let s = w.toLowerCase();
  if (s.length > 7) s = s.replace(/(ungen|heiten|keiten|ern|en|er|es|e|s|n)$/u, "");
  else if (s.length > 5) s = s.replace(/(en|es|er|e|s|n)$/u, "");
  return s;
}

/** Suchbegriffe aus einer Frage: ohne Füllwörter, Normzitate und Zahlen. */
export function searchTerms(question: string, max = 16): string[] {
  const words = question
    .replace(/(§§?|Artt?\.)\s*\d+\s*[a-z]?/g, " ")
    .split(/[^A-Za-zÄÖÜäöüß]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const s = stem(w);
    if (s.length < 3 || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export class LegalRetriever implements Retriever {
  constructor(private store: LegalStore) {}

  async retrieve(question: string, opts: { limit?: number; kinds?: LegalKind[] | null } = {}): Promise<LegalHit[]> {
    const limit = opts.limit ?? 8;
    const out: LegalHit[] = [];
    const seen = new Set<string>();
    const add = (hs: LegalHit[]) => {
      for (const h of hs) if (!seen.has(h.chunk_id)) seen.add(h.chunk_id) && out.push(h);
    };
    // 1. ausdrücklich genannte Normen (ganze Norm, damit Absätze im Zusammenhang stehen)
    const named = new Map<string, { law: string; norm: string }>();
    for (const c of findNormCitations(question)) if (c.law) named.set(`${c.law}|${normKey(c)}`, { law: c.law, norm: normKey(c) });
    for (const { law, norm } of [...named.values()].slice(0, 6)) add(await this.store.legalNorm(law, norm, null));
    // 2. Volltextsuche
    const terms = searchTerms(question);
    if (terms.length) add(await this.store.legalSearch(terms, opts.kinds ?? null, limit));
    return out;
  }
}

/** Kurzbezeichnung einer Quelle für Anzeige und Prompt, z. B. „§ 433 Abs. 1 BGB“ oder „BGH, VIII ZR 1/20“. */
export function hitLabel(h: LegalHit): string {
  if (h.kind === "gesetz") {
    const abs = h.absatz ? ` Abs. ${h.absatz}` : "";
    return `${h.norm}${abs} ${h.abbreviation}`.trim();
  }
  if (h.kind === "urteil") return [h.court, h.decision_date, h.file_number].filter(Boolean).join(", ") || h.title;
  return [h.title, h.heading].filter(Boolean).join(" – ");
}
