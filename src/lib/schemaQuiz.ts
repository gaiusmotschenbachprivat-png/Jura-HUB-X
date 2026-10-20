/**
 * Prüfungsschemata lernen: Reihenfolge der Prüfungspunkte legen und Punkte
 * aus dem Gedächtnis abfragen (Lückentext). Reine Funktionen, ohne Oberfläche.
 */
import type { SchemaItem } from "../api/types";
import { gliederung } from "./gliederung";

export interface QuizPoint {
  id: string;
  text: string;
  note: string;
  depth: number;
  /** Gliederungszeichen, z. B. „A.“, „I.“, „1.“ */
  label: string;
  /** Übergeordnete Punkte (Texte), zur Orientierung beim Abfragen */
  path: string[];
}

/** Schema als Liste in Prüfungsreihenfolge; leere Punkte fallen weg. */
export function quizPoints(items: SchemaItem[]): QuizPoint[] {
  const out: QuizPoint[] = [];
  const walk = (list: SchemaItem[], depth: number, path: string[]) => {
    let n = 0;
    for (const it of list) {
      const text = it.text.trim();
      if (!text) {
        walk(it.children, depth + 1, path);
        continue;
      }
      n++;
      out.push({ id: it.id, text, note: it.note?.trim() ?? "", depth, label: gliederung(depth, n), path });
      walk(it.children, depth + 1, [...path, text]);
    }
  };
  walk(items, 0, []);
  return out;
}

/** Fisher-Yates mit austauschbarem Zufall (für Tests). Mischt so, dass nicht zufällig alles richtig liegt. */
export function shuffled<T>(list: T[], rnd: () => number = Math.random): T[] {
  if (list.length < 2) return [...list];
  for (let tries = 0; tries < 5; tries++) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    if (a.some((x, i) => x !== list[i])) return a;
  }
  return [...list.slice(1), list[0]!];
}

/** Für das Vergleichen: klein, ohne Satzzeichen, Umlaute vereinheitlicht, §-Angaben behalten. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9§ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["der", "die", "das", "des", "dem", "den", "ein", "eine", "einer", "eines", "und", "oder", "i", "s", "d", "v", "zu", "zur", "zum", "im", "in", "bei", "nach", "abs", "nr", "satz", "von", "vom", "auf", "aus", "mit"]);

const LAW = new Set(["bgb", "stgb", "gg", "hgb", "zpo", "stpo", "vwvfg", "vwgo", "art", "abs", "nr", "s", "alt", "var", "ff", "f"]);
const isNormToken = (w: string) => w === "§" || /^\d+[a-z]?$/.test(w) || /^[ivx]+$/.test(w) || LAW.has(w);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Ein Wort gilt als getroffen bei kleinen Tippfehlern (Abstand ≤ 1 bzw. ≤ 2 bei langen Wörtern). */
function wordHit(w: string, words: string[]): boolean {
  const tol = w.length >= 9 ? 2 : w.length >= 5 ? 1 : 0;
  return words.some((x) => x === w || (tol > 0 && Math.abs(x.length - w.length) <= tol && levenshtein(x, w) <= tol) || (w.length >= 6 && (x.startsWith(w) || w.startsWith(x)) && Math.min(x.length, w.length) >= 6));
}

export type Verdict = "richtig" | "teilweise" | "falsch";

/**
 * Bewertet eine eingegebene Antwort gegen den Prüfungspunkt. Grob und
 * nachsichtig (Tippfehler, Wortstellung, Artikel); die endgültige Entscheidung
 * trifft der Nutzer selbst („gewusst“ / „nicht gewusst“).
 */
export function judgeAnswer(answer: string, expected: string): { verdict: Verdict; score: number } {
  const a = normalizeAnswer(answer);
  const e = normalizeAnswer(expected);
  if (!a) return { verdict: "falsch", score: 0 };
  if (a === e) return { verdict: "richtig", score: 1 };
  const key = e.split(" ").filter((w) => w && !STOP.has(w));
  const given = a.split(" ").filter((w) => w && !STOP.has(w));
  if (!key.length) return { verdict: levenshtein(a, e) <= 2 ? "richtig" : "falsch", score: 0 };
  // Inhaltswörter zählen mehr als Normangaben („§ 142 I BGB“)
  const content = key.filter((w) => !isNormToken(w));
  const norm = key.filter(isNormToken);
  const share = (ws: string[]) => (ws.length ? ws.filter((w) => wordHit(w, given)).length / ws.length : 1);
  const score = content.length ? (norm.length ? 0.8 * share(content) + 0.2 * share(norm) : share(content)) : share(norm);
  return { verdict: score >= 0.75 ? "richtig" : score >= 0.4 ? "teilweise" : "falsch", score };
}

/** Ergebnis in Worten. */
export function quizSummary(known: number, total: number): string {
  if (!total) return "";
  const p = Math.round((known / total) * 100);
  return `${known} von ${total} Punkten gewusst (${p} %)`;
}
