/**
 * Gesetze als Text (PDF, DOCX, TXT – z. B. die PDF-Fassung von
 * gesetze-im-internet.de) in einzelne Normen und Absätze zerlegen, genau wie
 * beim XML-Import. Nur so findet der Normabruf („§ 242 StGB“) die Vorschrift.
 *
 * - Kopf- und Fußzeilen der Seiten werden entfernt.
 * - Die Inhaltsübersicht am Anfang wird übersprungen.
 * - Eine Zeile „§ 242 Diebstahl“ beginnt eine neue Norm – aber nur, wenn die
 *   Nummer größer ist als die vorige, damit umbrochene Verweise („§ 21 gilt
 *   entsprechend“) nicht als neue Norm gelten.
 * - Abschnitts-/Titelüberschriften („Zweiter Abschnitt – Die Tat“) werden zur
 *   Gliederung, nicht zum Normtext.
 */
import type { NewLegalChunk, NewLegalSource } from "../../api/types";

const PAGE_FURNITURE = [/^-?\s*Seite \d+ von \d+\s*-?$/i, /^Ein Service des Bundesministerium/i, /^sowie des Bundesamts für Justiz/i, /^www\.gesetze-im-internet\.de$/i];
const NORM_LINE = /^(§{1,2}|Art\.?|Artikel)\s*(\d+)\s*([a-z]{0,2})\b\s*(.*)$/;
const ORDINAL = "(?:Erst|Zweit|Dritt|Viert|Fünft|Sechst|Siebt|Acht|Neunt|Zehnt|Elft|Zwölft|[A-ZÄÖÜ][a-zäöüß]+zehnt|[A-ZÄÖÜ][a-zäöüß]+(?:zigst|ßigst)|Dreißigst|Hundertst)(?:er|es|e)";
const STRUCTURE = new RegExp(`^(?:${ORDINAL}\\s+(?:Buch|Teil|Abschnitt|Unterabschnitt|Titel|Untertitel|Kapitel)|(?:Allgemeiner|Besonderer)\\s+Teil|(?:Buch|Teil|Abschnitt|Unterabschnitt|Titel|Untertitel|Kapitel|Unterkapitel)\\s+\\d+[a-z]?)\\s*$`, "i");
/** BGB-Form in einer Zeile: „Titel 1 - Natürliche Personen, Verbraucher, Unternehmer“ */
const STRUCTURE_NAMED = /^(?:Buch|Teil|Abschnitt|Unterabschnitt|Titel|Untertitel|Kapitel|Unterkapitel)\s+\d+[a-z]?\s+[-–]\s+\S.{0,140}$/;

/** „Z w e i t e r  A b s c h n i t t“ → „Zweiter Abschnitt“ */
function unspace(line: string): string {
  return /^(?:\S ){3,}\S(?:\s|$)/.test(line) ? line.replace(/(\S) (?=\S( |$))/g, "$1").replace(/\s{2,}/g, " ").trim() : line;
}

interface NormKey {
  n: number;
  s: string;
}
const keyOf = (num: string, suffix: string): NormKey => ({ n: Number(num), s: suffix });
const after = (a: NormKey, b: NormKey | null) => !b || a.n > b.n || (a.n === b.n && a.s > b.s);

/**
 * Text eines Gesetzes aus den Abschnitten eines früheren Text-Imports (vor 0.19
 * wurden Gesetz-PDFs in Stücke zu 1500 Zeichen zerlegt) wieder zusammensetzen.
 * Beim Zerlegen gingen einzelne Zeilenumbrüche verloren; sie werden hier vor
 * Absatznummern „(2)“ und Gliederungsüberschriften wieder eingefügt.
 */
export function lawTextFromChunks(chunks: readonly { text: string }[], max = 1500): string {
  let out = "";
  let prev = "";
  for (const c of chunks) {
    // Stücke mit voller Länge wurden mitten im Text abgeschnitten
    out += (out ? ([...prev].length >= max ? "" : "\n") : "") + c.text;
    prev = c.text;
  }
  const level = "(?:Buch|Teil|Abschnitt|Unterabschnitt|Titel|Untertitel|Kapitel)";
  return out
    .replace(/([.;:]) (\(\d+[a-z]?\) )/g, "$1\n$2")
    .replace(new RegExp(`([.;:)]) (${ORDINAL} ${level}|(?:Allgemeiner|Besonderer) Teil)(?=\\s|$)`, "gm"), "$1\n$2")
    .replace(new RegExp(`^(${ORDINAL} ${level}) (?=\\S)`, "gm"), "$1\n");
}

export interface ParsedLaw {
  source: NewLegalSource;
  chunks: NewLegalChunk[];
}

/** Erkennt Titel, Abkürzung und Stand aus dem Kopf (Form von gesetze-im-internet.de). */
export function lawHeader(lines: string[]): { title: string; abbreviation: string; version: string } {
  let title = "";
  let abbreviation = "";
  const version: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const l = lines[i]!;
    const m = /^(.{4,200}?)\s*\(([A-Za-zÄÖÜäöü][\w.ÄÖÜäöü-]{1,20})\)\s*$/.exec(l);
    if (!title && m && !NORM_LINE.test(l)) {
      title = m[1]!.trim();
      abbreviation = m[2]!.trim();
    }
    if (/^Stand:/i.test(l)) {
      version.push(l.replace(/^Stand:\s*/i, ""));
      for (let j = i + 1; j < Math.min(lines.length, i + 4) && /^(zuletzt|geändert|neugefasst|mittelbar|\+\+\+)/i.test(lines[j]!); j++) version.push(lines[j]!);
    }
  }
  return { title, abbreviation, version: version.join(" ").replace(/\s+/g, " ").trim() };
}

/** Sieht der Text nach einem Gesetz aus (genug Normüberschriften)? */
export function looksLikeLaw(text: string): boolean {
  let n = 0;
  for (const l of text.split("\n")) if (NORM_LINE.test(l.trim()) && ++n >= 8) return true;
  return false;
}

export function parseLawText(text: string, opts: { title?: string; abbreviation?: string; origin: string }): ParsedLaw {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l) => l && !PAGE_FURNITURE.some((r) => r.test(l)));
  const head = lawHeader(lines);
  const title = opts.title?.trim() || head.title || opts.origin.replace(/\.[^.]+$/, "");
  const abbreviation = (opts.abbreviation?.trim() || head.abbreviation).slice(0, 40);

  // Normüberschriften finden; Inhaltsübersicht = erster Durchlauf, Normtext beginnt beim zweiten Auftreten der ersten Norm
  const heads: { i: number; label: string }[] = [];
  lines.forEach((l, i) => {
    const m = NORM_LINE.exec(l);
    if (m) heads.push({ i, label: `${m[1]!.startsWith("§") ? "§" : "Art."} ${m[2]}${m[3]}` });
  });
  if (!heads.length) throw new Error("In der Datei wurden keine Paragraphen (§ …) oder Artikel gefunden.");
  const first = heads[0]!.label;
  const again = heads.findIndex((h, k) => k > 0 && h.label === first);
  let bodyStart = again > 0 ? heads[again]!.i : heads[0]!.i;
  // Gliederungsüberschriften direkt vor der ersten Norm gehören schon zum Gesetzestext („Buch 1 / Allgemeiner Teil / …“)
  const isStructure = (l: string | undefined) => !!l && (STRUCTURE.test(unspace(l)) || STRUCTURE_NAMED.test(l));
  const isName = (l: string | undefined) => !!l && l.length <= 90 && !/[.;:,]$/.test(l) && !NORM_LINE.test(l);
  for (let k = 0; k < 12 && bodyStart > 0; k++) {
    if (isStructure(lines[bodyStart - 1])) bodyStart--;
    else if (isName(lines[bodyStart - 1]) && isStructure(lines[bodyStart - 2])) bodyStart -= 2;
    else break;
  }
  // Inhaltsübersicht (falls vorhanden): welche Normen mit welchem Titel es gibt
  const toc = new Map<string, string>();
  if (again > 0)
    for (const h of heads.slice(0, again)) {
      const m = NORM_LINE.exec(lines[h.i]!);
      if (m) toc.set(h.label, m[4]!.trim().toLowerCase());
    }
  const sameTitle = (a: string, b: string) => {
    const x = a.toLowerCase().slice(0, 24);
    const y = b.slice(0, 24);
    return x === y || x.startsWith(y) || y.startsWith(x);
  };

  const chunks: NewLegalChunk[] = [];
  let gliederung = "";
  let cur: { norm: string; title: string; gliederung: string; lines: string[] } | null = null;
  let last: NormKey | null = null;
  let pendingStructure = false;

  const flush = () => {
    if (!cur) return;
    // Gliederung vom Beginn der Norm – eine folgende Abschnittsüberschrift gehört schon zur nächsten
    const heading = [cur.title, cur.gliederung].filter(Boolean).join(" – ");
    // Absätze „(1) …“ als eigene Abschnitte, sonst die ganze Norm
    const parts: string[] = [];
    for (const l of cur.lines) {
      if (/^\(\d+[a-z]?\)\s/.test(l) || !parts.length) parts.push(l);
      else parts[parts.length - 1] += (/-$/.test(parts[parts.length - 1]!) ? "" : " ") + l;
    }
    if (!parts.length) parts.push(cur.title || "(ohne Text)");
    for (const p of parts) {
      const m = /^\((\d+)[a-z]?\)\s*/.exec(p);
      chunks.push({ norm: cur.norm, absatz: m ? Number(m[1]) : null, heading, text: p.trim() });
    }
    cur = null;
  };

  for (let i = bodyStart; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = unspace(raw);
    // „§§ 116 bis 119 (weggefallen)“: aufgehobene Normen, kein Normtext
    if (/^(§§?|Art\.?|Artikel)\s*\d+[a-z]{0,2}(\s+(bis|und)\s+\d+[a-z]{0,2})?\s*\(weggefallen\)$/.test(line)) {
      if (!/^§§/.test(line)) {
        const w = NORM_LINE.exec(line);
        if (w && after(keyOf(w[2]!, w[3]!), last)) {
          flush();
          last = keyOf(w[2]!, w[3]!);
          chunks.push({ norm: `${w[1]!.startsWith("§") ? "§" : "Art."} ${w[2]}${w[3]}`, absatz: null, heading: gliederung, text: "(weggefallen)" });
        }
      }
      continue;
    }
    const m = NORM_LINE.exec(line);
    if (m) {
      const k = keyOf(m[2]!, m[3]!);
      const rest = m[4]!.trim();
      // Normüberschrift: nächste Nummer (kleine Lücken erlaubt), Titel beginnt groß bzw. „(weggefallen)“ –
      // umbrochene Verweise („§ 309 Abs. 2 und …“, „§ 323a, soweit …“) zählen nicht
      const label = `${m[1]!.startsWith("§") ? "§" : "Art."} ${m[2]}${m[3]}`;
      const inToc = toc.size > 0 && toc.has(label) && sameTitle(rest, toc.get(label)!);
      const plausible = toc.size > 0 ? inToc : (!last || k.n - last.n <= 25) && !/^(Abs\.|Absatz|Satz|Nr\.|Nummer|bis|und|oder|in|im|der|des|gilt|ist|sind|bleibt|findet|[,;)])/.test(rest) && (rest === "" || /^[A-ZÄÖÜ(]/.test(rest));
      if (plausible && after(k, last)) {
        flush();
        last = k;
        const isPara = m[1]!.startsWith("§");
        cur = { norm: `${isPara ? "§" : "Art."} ${m[2]}${m[3]}`, title: m[4]!.trim(), gliederung, lines: [] };
        pendingStructure = false;
        continue;
      }
    }
    if (STRUCTURE_NAMED.test(line) && !/[.;:,]$/.test(line)) {
      gliederung = line.replace(/\s+[-–]\s+/, " ");
      pendingStructure = false;
      continue;
    }
    if (STRUCTURE.test(line) || line !== raw) {
      // Gliederungsüberschrift; die folgende kurze Zeile ist ihr Name
      gliederung = line;
      pendingStructure = true;
      continue;
    }
    if (pendingStructure && line.length <= 90 && !/[.;:,]$/.test(line) && !/^\(/.test(line)) {
      gliederung = `${gliederung} ${line}`.trim();
      pendingStructure = false;
      continue;
    }
    pendingStructure = false;
    if (/^- [^-]+ -$/.test(line)) continue; // Zwischenüberschrift wie „- Freiheitsstrafe -“
    cur?.lines.push(line);
  }
  flush();
  if (chunks.length < 3) throw new Error("Die Datei sieht nicht wie ein Gesetzestext aus (zu wenige Paragraphen erkannt).");
  return { source: { kind: "gesetz", title, abbreviation, version: head.version, origin: opts.origin }, chunks };
}
