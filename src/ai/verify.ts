/**
 * Ausgabeprüfung: Jedes zitierte Gesetz, jeder Paragraf/Artikel und jedes
 * Urteil wird gegen die tatsächlich abgerufenen Quellen geprüft.
 *
 * Status je Zitat:
 * - belegt: Norm (und ggf. Absatz) bzw. Entscheidung liegt als Quelle vor
 * - absatz_nicht_belegt: Norm liegt vor, der zitierte Absatz aber nicht
 * - nicht_belegt: nicht unter den abgerufenen Quellen (Wissen des Modells)
 * - existiert_nicht: das Gesetz ist importiert, die Norm/der Absatz gibt es darin nicht → wahrscheinlich erfunden
 * - verweis: nur als Verweis im Wortlaut einer abgerufenen Norm genannt (z. B. „§§ 174 bis 174c“
 *   in § 78b StGB); der eigene Wortlaut wurde nicht abgerufen (nur Hinweis)
 * - ohne_gesetz: Norm ohne Gesetzesangabe (nur Hinweis)
 */
import type { LegalHit, LegalSource } from "../api/types";
import { DISCLAIMER } from "./config";
import { findCitations, formatNorm, normalizeCaseRef, normKey, type Citation } from "./norms";
import type { LegalStore } from "./retrieval";
import type { SourceRegistry } from "./sources/registry";

export type CheckStatus = "belegt" | "absatz_nicht_belegt" | "nicht_belegt" | "existiert_nicht" | "verweis" | "ohne_gesetz";

export interface CitationCheck {
  label: string;
  raw: string;
  index: number;
  kind: "norm" | "urteil";
  status: CheckStatus;
  detail: string;
  /** Quellenkennungen, die das Zitat belegen */
  sources: string[];
}

export interface VerifyReport {
  checks: CitationCheck[];
  /** im Text verwendete Kennungen [Qn], die es nicht gibt */
  unknownSourceIds: string[];
  hasDisclaimer: boolean;
  ok: boolean;
  counts: Record<CheckStatus, number>;
}

export type VerifyStore = LegalStore & { legalSourcesList?: () => Promise<LegalSource[]> };

const lc = (s: string) => s.toLowerCase();

export async function verifyAnswer(text: string, registry: SourceRegistry, store: VerifyStore): Promise<VerifyReport> {
  const regs = registry.all;
  const imported = new Set((store.legalSourcesList ? await store.legalSourcesList() : []).filter((s) => s.kind === "gesetz").map((s) => lc(s.abbreviation)));
  const checks: CitationCheck[] = [];
  const seen = new Set<string>();
  for (const c of findCitations(text)) {
    const check = c.type === "norm" ? await checkNorm(c, regs, store, imported) : checkCase(c, regs);
    const key = `${check.label}|${check.status}`;
    if (seen.has(key)) continue; // gleiche Zitate nur einmal melden
    seen.add(key);
    checks.push(check);
  }
  const used = [...text.matchAll(/\[Q(\d+)\]/g)].map((m) => `Q${m[1]}`);
  const unknownSourceIds = [...new Set(used.filter((id) => !registry.byId(id)))];
  const counts = { belegt: 0, absatz_nicht_belegt: 0, nicht_belegt: 0, existiert_nicht: 0, verweis: 0, ohne_gesetz: 0 } as Record<CheckStatus, number>;
  for (const ch of checks) counts[ch.status]++;
  const ok = counts.nicht_belegt === 0 && counts.existiert_nicht === 0 && counts.absatz_nicht_belegt === 0 && unknownSourceIds.length === 0;
  return { checks, unknownSourceIds, hasDisclaimer: text.includes(DISCLAIMER), ok, counts };
}

async function checkNorm(
  c: Extract<Citation, { type: "norm" }>,
  regs: readonly { id: string; hit: LegalHit }[],
  store: VerifyStore,
  imported: Set<string>,
): Promise<CitationCheck> {
  const label = formatNorm(c);
  const base = { label, raw: c.raw, index: c.index, kind: "norm" as const };
  if (!c.law) return { ...base, status: "ohne_gesetz", detail: "Zitat ohne Gesetzesangabe.", sources: [] };
  const key = normKey(c);
  const matches = regs.filter((r) => r.hit.kind === "gesetz" && lc(r.hit.abbreviation) === lc(c.law) && r.hit.norm === key);
  if (matches.length) {
    if (!c.absatz) return { ...base, status: "belegt", detail: "", sources: matches.map((m) => m.id) };
    const exact = matches.filter((m) => m.hit.absatz === c.absatz || (m.hit.absatz === null && new RegExp(`\\(${c.absatz}\\)`).test(m.hit.text)));
    if (exact.length) return { ...base, status: "belegt", detail: "", sources: exact.map((m) => m.id) };
    const all = await store.legalNorm(c.law, key, null);
    const hasNumbered = all.some((h) => h.absatz !== null);
    if (hasNumbered && !all.some((h) => h.absatz === c.absatz)) {
      return { ...base, status: "existiert_nicht", detail: `${key} ${c.law} hat keinen Absatz ${c.absatz}.`, sources: [] };
    }
    return { ...base, status: "absatz_nicht_belegt", detail: `Der zitierte Absatz ${c.absatz} liegt nicht als Quelle vor.`, sources: matches.map((m) => m.id) };
  }
  const inDb = await store.legalNorm(c.law, key, null);
  if (inDb.length) {
    if (c.absatz && inDb.some((h) => h.absatz !== null) && !inDb.some((h) => h.absatz === c.absatz)) {
      return { ...base, status: "existiert_nicht", detail: `${key} ${c.law} hat keinen Absatz ${c.absatz}.`, sources: [] };
    }
    const refs = regs.filter((r) => r.hit.kind === "gesetz" && lc(r.hit.abbreviation) === lc(c.law) && mentions(r.hit.text, key));
    if (refs.length) {
      const ids = refs.map((r) => r.id);
      return { ...base, status: "verweis", detail: `Wird in ${ids.slice(0, 3).join(", ")} genannt; der Wortlaut von ${key} selbst wurde nicht abgerufen.`, sources: ids };
    }
    return { ...base, status: "nicht_belegt", detail: "Die Norm ist importiert, wurde aber nicht als Quelle abgerufen.", sources: [] };
  }
  if (imported.has(lc(c.law))) {
    return { ...base, status: "existiert_nicht", detail: `${key} ist im importierten ${c.law} nicht enthalten.`, sources: [] };
  }
  return { ...base, status: "nicht_belegt", detail: `Das Gesetz ${c.law} ist nicht importiert.`, sources: [] };
}

/** Nennt der Normtext die Vorschrift (z. B. „§§ 174 bis 174c, 176“ oder „nach § 211“)? */
export function mentions(text: string, key: string): boolean {
  const m = /^(§|Art\.)\s(\d+[a-z]?)$/.exec(key);
  if (!m) return false;
  const sign = m[1] === "§" ? "§§?" : "Art(?:\\.|ikel)";
  // „Absatz 1 Satz 1 Nummer 3“: Zahlen hinter Absatz/Satz/Nummer sind keine Paragraphen
  const notSub = "(?<!(?:Abs\\.|Absatz|Satz|S\\.|Nr\\.|Nummer|Buchstabe|Halbsatz|Art\\.|Artikel)\\s)";
  return new RegExp(`${sign}\\s*(?:[^;§]{0,150}?[\\s,(])?${notSub}${m[2]}(?![\\da-z])`).test(text);
}

function checkCase(c: Extract<Citation, { type: "case" }>, regs: readonly { id: string; hit: LegalHit }[]): CitationCheck {
  const ref = c.reference;
  const hits = regs.filter(
    (r) => (r.hit.file_number && normalizeCaseRef(r.hit.file_number) === ref) || r.hit.text.replace(/\s+/g, " ").includes(ref),
  );
  return hits.length
    ? { label: ref, raw: c.raw, index: c.index, kind: "urteil", status: "belegt", detail: "", sources: hits.map((h) => h.id) }
    : { label: ref, raw: c.raw, index: c.index, kind: "urteil", status: "nicht_belegt", detail: "Die Entscheidung liegt nicht als Quelle vor.", sources: [] };
}

/** Überarbeitungsauftrag an Claude, wenn Zitate nicht belegt sind. */
export function revisionRequest(r: VerifyReport): string {
  const lines = r.checks
    .filter((c) => c.status === "nicht_belegt" || c.status === "existiert_nicht" || c.status === "absatz_nicht_belegt")
    .map((c) => `- ${c.label}: ${c.detail}`);
  for (const id of r.unknownSourceIds) lines.push(`- [${id}]: Diese Quellenkennung gibt es nicht.`);
  return (
    "Automatische Prüfung der Zitate deiner Antwort:\n" +
    lines.join("\n") +
    "\n\nÜberarbeite die Antwort: Hole fehlende Normen mit `norm_abrufen`, wenn sie existieren können, und belege sie mit ihrer Quellenkennung. " +
    "Entferne Zitate, die es nicht gibt. Was sich nicht belegen lässt, kennzeichne ausdrücklich als „nicht durch die vorliegenden Quellen belegt“. " +
    "Gib die vollständige überarbeitete Antwort aus."
  );
}
