/**
 * Erkennen juristischer Zitate in Texten: Normen (§/Art. mit Absatz, Satz,
 * Nummer und Gesetz) und Gerichtsentscheidungen (Aktenzeichen, Fundstellen).
 * Grundlage für die Suche (Normen in der Frage) und die Ausgabeprüfung.
 */

export interface NormCitation {
  type: "norm";
  /** „§“ oder „Art.“ */
  sign: "§" | "Art.";
  /** z. B. „433“, „312g“ */
  number: string;
  absatz: number | null;
  satz: number | null;
  nr: number | null;
  /** Gesetz, z. B. „BGB“ (leer, wenn im Text keines genannt ist) */
  law: string;
  /** Fundstelle im Text */
  raw: string;
  index: number;
}

export interface CaseCitation {
  type: "case";
  /** normalisiert, z. B. „VIII ZR 123/20“ oder „NJW 2020, 123“ */
  reference: string;
  raw: string;
  index: number;
}

export type Citation = NormCitation | CaseCitation;

/** Normbezeichnung wie in der Datenbank: „§ 433“, „Art. 20“. */
export function normKey(c: Pick<NormCitation, "sign" | "number">): string {
  return `${c.sign} ${c.number}`;
}

export function formatNorm(c: NormCitation): string {
  let s = normKey(c);
  if (c.absatz) s += ` Abs. ${c.absatz}`;
  if (c.satz) s += ` S. ${c.satz}`;
  if (c.nr) s += ` Nr. ${c.nr}`;
  return c.law ? `${s} ${c.law}` : s;
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };

/** Gesetzesabkürzungen: mindestens zwei Großbuchstaben (BGB, StGB, GG, KSchG, VwGO, BayBO …). */
const LAW = String.raw`(?:[A-ZÄÖÜ][a-zäöü]*){0,3}[A-ZÄÖÜ](?:[A-Za-zÄÖÜäöü]*)`;
const LAW_RE = new RegExp(`^${LAW}$`);
const NOT_LAWS = new Set(["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "S", "Nr", "Abs", "Alt", "Var", "Hs", "Art", "UAbs", "Rn"]);

function isLaw(tok: string): boolean {
  if (!LAW_RE.test(tok) || NOT_LAWS.has(tok)) return false;
  const caps = tok.replace(/[^A-ZÄÖÜ]/g, "").length;
  return caps >= 2 || /^(?:[A-ZÄÖÜ][a-zäöü]+)+G$/.test(tok);
}

/**
 * Sucht Normzitate. Unterstützt u. a.:
 * „§ 433 Abs. 1 S. 2 BGB“, „§ 823 I BGB“, „§§ 433, 434 BGB“, „§§ 280 Abs. 1, 3, 281 BGB“,
 * „§§ 305 ff. BGB“, „Art. 2 Abs. 1 i. V. m. Art. 1 Abs. 1 GG“, „§ 1 Abs. 2 Satz 1 Nr. 3 KSchG“.
 */
export function findNormCitations(text: string): NormCitation[] {
  const out: NormCitation[] = [];
  // Ein Zitatblock beginnt mit §, §§, Art. oder Artt. und läuft bis einschließlich Gesetz
  const START = /(§§?|Artt?\.|Artikel)\s*(?=\d)/g;
  let m: RegExpExecArray | null;
  while ((m = START.exec(text))) {
    const sign: "§" | "Art." = m[1]!.startsWith("§") ? "§" : "Art.";
    const start = m.index;
    // Block bis zum Gesetz oder Satzende, max. 160 Zeichen
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 160);
    const tokens = rest.match(/\d+[a-z]\b|\d+|[A-Za-zÄÖÜäöü]+\.?|[,;()]|\S/g) ?? [];
    type Item = Omit<NormCitation, "law" | "raw" | "index" | "type" | "sign">;
    const items: Item[] = [];
    let cur: Item | null = null;
    // Feld, dem die nächste Zahl zugeordnet wird (nach „Abs.“, „S.“, „Nr.“)
    let field: "absatz" | "satz" | "nr" | null = null;
    // zuletzt befülltes Feld und ob seitdem ein Komma kam („Abs. 1, 3“)
    let lastField: "absatz" | "satz" | "nr" | null = null;
    let afterComma = false;
    let law = "";
    let consumed = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      const next = tokens[i + 1];
      if (/^\d/.test(t)) {
        if (field && cur) {
          cur[field] = Number(t);
          lastField = field;
        } else if (afterComma && lastField && cur && Number(t) <= 20 && Number(t) < Number.parseInt(cur.number, 10)) {
          // „§ 280 Abs. 1, 3“: gleicher Paragraf, weiterer Absatz
          const base: Item = cur as Item;
          cur = { ...base, [lastField]: Number(t) };
          items.push(cur);
        } else {
          cur = { number: t, absatz: null, satz: null, nr: null };
          items.push(cur);
          lastField = null;
        }
        field = null;
        afterComma = false;
        consumed = i + 1;
        continue;
      }
      const w = t.replace(/\.$/, "");
      if (w === "Abs" || w === "Absatz") field = "absatz";
      else if (w === "S" || w === "Satz") field = "satz";
      else if (w === "Nr" || w === "Nummer") field = "nr";
      else if (ROMAN[w] !== undefined && cur && cur.absatz === null && !field && lastField === null) {
        cur.absatz = ROMAN[w]!;
        lastField = "absatz";
      } else if (w === "ff" || w === "f") {
        /* „§§ 305 ff.“ – Folgeparagrafen nicht einzeln */
      } else if (w === "Alt" || w === "Var" || w === "Hs" || w === "lit" || w === "UAbs" || w === "Halbsatz" || w === "Fall") {
        i++; // Wert überspringen
      } else if (t === ",") {
        afterComma = true;
      } else if (t === ";") {
        break;
      } else if (w === "und" || w === "bis" || w === "sowie" || w === "oder") {
        afterComma = true;
      } else if (w === "i" || w === "V" || w === "m" || w === "iVm" || w === "iSd" || w === "iSv" || w === "d" || w === "v") {
        // „i. V. m.“ – die verknüpfte Norm beginnt mit eigenem §/Art.
        if (next && /^(§|Art)/.test(next)) break;
      } else if (isLaw(w)) {
        law = w;
        consumed = i + 1;
        break;
      } else break;
    }
    if (!items.length) continue;
    const rawEnd = tokens.slice(0, consumed).join(" ");
    for (const it of items) out.push({ type: "norm", sign, ...it, law, raw: `${m[1]} ${rawEnd}`.trim(), index: start });
  }
  // Gesetz für „Art. 2 Abs. 1 i. V. m. Art. 1 Abs. 1 GG“ nach vorne übertragen
  for (let k = out.length - 2; k >= 0; k--) {
    const a = out[k]!;
    const b = out[k + 1]!;
    if (!a.law && b.law && b.index - a.index < 80 && a.sign === b.sign) a.law = b.law;
  }
  return out;
}

const COURT_FILE = /\b((?:[IVX]+|\d{1,2})\s?(?:ZR|ZB|StR|AZR|ABR|BvR|BvL|BvE|BvF|C|K|B|U|O|S|Ss|ZA|AR)\s?\d{1,5}\/\d{2})\b/g;
const JOURNAL = /\b((?:NJW(?:-RR)?|NZA(?:-RR)?|JZ|JuS|JA|Jura|NStZ(?:-RR)?|NVwZ(?:-RR)?|BGHZ|BGHSt|BVerfGE|BVerwGE|BAGE|MDR|ZIP|WM|DVBl|DÖV)\s?\d{1,4},\s?\d{1,5})\b/g;

export function findCaseCitations(text: string): CaseCitation[] {
  const out: CaseCitation[] = [];
  for (const re of [COURT_FILE, JOURNAL]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push({ type: "case", reference: normalizeCaseRef(m[1]!), raw: m[1]!, index: m.index });
  }
  return out;
}

export function normalizeCaseRef(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/^([IVX]+|\d{1,2})\s?([A-Za-z]+)\s?(\d)/, "$1 $2 $3")
    .replace(/,\s?/, ", ")
    .trim();
}

export function findCitations(text: string): Citation[] {
  return [...findNormCitations(text), ...findCaseCitations(text)].sort((a, b) => a.index - b.index);
}
