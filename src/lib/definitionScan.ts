/**
 * Definitionen in einer Mitschrift finden, damit sie ins Glossar übernommen
 * werden können. Erkannt wird, was Studierende beim Mitschreiben typischerweise
 * tun:
 *  - Begriff **fett** am Absatzanfang, danach Doppelpunkt/Gedankenstrich oder „ist/sind …“
 *  - Absatz beginnt mit „Definition:“ bzw. „Def.:“, danach „Begriff: Text“ oder „Begriff ist Text“
 * Bewusst zurückhaltend – lieber eine Definition übersehen als Unsinn vorschlagen.
 */
import type { Node as PMNode } from "@tiptap/pm/model";

export interface DefinitionCandidate {
  term: string;
  text: string;
  /** Position des Begriffs im Dokument (zum Verlinken); null, wenn er nicht eindeutig zu fassen ist */
  termFrom: number | null;
  termTo: number | null;
  /** Steht der Begriff schon als Link im Text? */
  linked: boolean;
}

const SEP = /^\s*(?::|–|—|-|=|\bist\b|\bsind\b|\bbedeutet\b|\bmeint\b|\bbezeichnet\b|\bversteht man\b)\s*/i;
const DEF_PREFIX = /^\s*(?:definition|def\.)\s*:?\s*/i;
const SPLIT = /^(.{2,80}?)\s*(?::|–|—|\s-\s|=|\s(?:ist|sind|bedeutet|meint|bezeichnet)\s)\s*(.+)$/is;

const cleanTerm = (s: string) => s.replace(/[:–—=\s-]+$/u, "").replace(/^[\s„"»]+|[\s“"«]+$/gu, "").trim();
const cleanText = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
};
const plausible = (term: string, text: string) =>
  term.length >= 2 && term.length <= 80 && term.split(/\s+/).length <= 8 && text.length >= 10 && !/^\d+[.)]?$/.test(term) && !/^[§(]/.test(term);

export function scanDefinitions(doc: PMNode): DefinitionCandidate[] {
  const out: DefinitionCandidate[] = [];
  const seen = new Set<string>();
  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return true;
    const text = node.textContent;
    if (!text.trim()) return false;
    let cand: DefinitionCandidate | null = null;

    // 1. Fetter Begriff am Absatzanfang
    const first = node.firstChild;
    if (first?.isText && first.marks.some((m) => m.type.name === "bold") && first.text?.trim()) {
      let bold = "";
      let boldEnd = 0;
      let linked = false;
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c.isText || !c.marks.some((m) => m.type.name === "bold")) break;
        bold += c.text ?? "";
        boldEnd += c.nodeSize;
        if (c.marks.some((m) => m.type.name === "link")) linked = true;
      }
      const term = cleanTerm(bold);
      const rest = text.slice(bold.length);
      const m = SEP.exec(rest);
      // Doppelpunkt kann auch noch im fetten Teil stehen („**Willenserklärung:** …“)
      const sepInBold = /[:–—=]\s*$/.test(bold);
      if ((m || sepInBold) && plausible(term, rest.replace(SEP, ""))) {
        const lead = bold.length - bold.trimStart().length;
        cand = { term, text: cleanText(rest.replace(SEP, "")), termFrom: pos + 1 + lead, termTo: pos + 1 + lead + term.length, linked };
        void boldEnd;
      }
    }

    // 2. „Definition: Begriff – Text“
    if (!cand && DEF_PREFIX.test(text) && /^\s*def/i.test(text)) {
      const body = text.replace(DEF_PREFIX, "");
      const m = SPLIT.exec(body);
      if (m) {
        const term = cleanTerm(m[1]!);
        const def = m[2]!;
        if (plausible(term, def)) {
          const at = text.indexOf(term, text.length - body.length);
          cand = { term, text: cleanText(def), termFrom: at >= 0 ? pos + 1 + at : null, termTo: at >= 0 ? pos + 1 + at + term.length : null, linked: false };
        }
      }
    }

    if (cand) {
      const key = cand.term.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(cand);
      }
    }
    return false;
  });
  return out;
}
