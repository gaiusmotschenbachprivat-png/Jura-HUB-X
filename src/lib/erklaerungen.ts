/**
 * „Begriffe & Erklärungen“: Bereich am Ende einer Mitschrift (Knoten
 * `erklaerungen`). Jeder Absatz darin ist ein Eintrag „Begriff – Erklärung“:
 * der fett geschriebene Anfang (oder der Text vor „–“ bzw. „:“) ist der
 * Begriff, der Rest die Erklärung. Die Übersicht „Erklärungen“ sammelt die
 * Einträge aller Mitschriften automatisch.
 */
import type { PMNode } from "./pm";

export interface Explanation {
  term: string;
  text: string;
}

export const SECTION_LABEL = "Begriffe & Erklärungen";

const inlineText = (n: PMNode): string =>
  n.type === "text" ? (n.text ?? "") : n.type === "hardBreak" ? " " : (n.content ?? []).map(inlineText).join("");

const SEP = /^\s*[–—:\-]\s*/;

/** Ein Absatz → Eintrag (oder null, wenn leer). */
export function parseEntry(p: PMNode): Explanation | null {
  const parts = p.content ?? [];
  const full = parts.map(inlineText).join("").replace(/\s+/g, " ").trim();
  if (!full) return null;
  // fett geschriebener Anfang = Begriff
  let bold = "";
  for (const c of parts) {
    if (c.type === "text" && c.marks?.some((m) => m.type === "bold")) bold += c.text ?? "";
    else break;
  }
  bold = bold.replace(/\s+/g, " ").trim().replace(/[–—:\-]\s*$/, "").trim();
  if (bold && full.startsWith(bold)) return { term: bold, text: full.slice(bold.length).replace(SEP, "").trim() };
  const m = /^(.{1,80}?)\s+[–—]\s+(.*)$/.exec(full) ?? /^([^:]{1,80}):\s*(.*)$/.exec(full);
  if (m) return { term: m[1]!.trim(), text: m[2]!.trim() };
  return { term: full.length <= 80 ? full : full.slice(0, 80), text: full.length <= 80 ? "" : full };
}

/** Alle Einträge einer Mitschrift (in Reihenfolge). */
export function explanationsOf(doc: PMNode): Explanation[] {
  const out: Explanation[] = [];
  const collect = (n: PMNode) => {
    if (n.type === "paragraph") {
      const e = parseEntry(n);
      if (e) out.push(e);
      return;
    }
    if (n.type === "heading") return;
    n.content?.forEach(collect);
  };
  const walk = (n: PMNode) => {
    if (n.type === "erklaerungen") n.content?.forEach(collect);
    else n.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

export const sameTerm = (a: string, b: string) => a.localeCompare(b, "de", { sensitivity: "base" }) === 0;
