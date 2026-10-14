/**
 * Aufteilung von Fließtexten (Urteile, Kommentare, eigene Dokumente) in
 * Abschnitte. Grenzen sind Absätze; Randnummern („Rn. 12“ oder eine Zahl am
 * Zeilenanfang) werden als Überschrift übernommen. Ein Abschnitt hat höchstens
 * etwa `max` Zeichen und endet nie mitten in einem Absatz, außer der Absatz
 * selbst ist länger.
 */
import type { NewLegalChunk } from "../../api/types";

export function chunkText(input: string, max = 1500): NewLegalChunk[] {
  const paras = input
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n|\n(?=\s*(?:Rn\.?\s*)?\d{1,4}\s+[A-ZÄÖÜ])/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const out: NewLegalChunk[] = [];
  let buf = "";
  let heading = "";
  const flush = () => {
    if (buf.trim()) out.push({ norm: "", absatz: null, heading, text: buf.trim() });
    buf = "";
  };
  for (const p of paras) {
    const rn = /^(?:Rn\.?\s*)?(\d{1,4})\s+(?=[A-ZÄÖÜ])/.exec(p);
    if (buf && buf.length + p.length + 2 > max) flush();
    if (!buf) heading = rn ? `Rn. ${rn[1]}` : headingOf(p);
    if (p.length > max) {
      // überlange Absätze an Satzgrenzen teilen
      for (const piece of splitSentences(p, max)) {
        if (buf) flush();
        buf = piece;
        flush();
      }
      continue;
    }
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  flush();
  return out;
}

function headingOf(p: string): string {
  const firstLine = p.split("\n")[0] ?? "";
  return firstLine.length <= 90 && !/[.:;]$/.test(firstLine) ? firstLine : "";
}

function splitSentences(p: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const s of p.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„(])/)) {
    if (cur && cur.length + s.length + 1 > max) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur} ${s}` : s;
    while (cur.length > max) {
      out.push(cur.slice(0, max));
      cur = cur.slice(max);
    }
  }
  if (cur) out.push(cur);
  return out;
}
