/**
 * Welches Gesetz ist gemeint, wenn in der Mitschrift nur „§ 433 I“ steht?
 * 1. Das zuletzt davor im Text genannte Gesetz (getrennt für § und Art.).
 * 2. Sonst das Gesetz, auf das Titel der Notiz bzw. der Veranstaltung deuten
 *    („BGB AT I.“ → BGB, „Strafrecht AT“ → StGB, „Staatsorganisation“ → GG).
 * 3. Sonst – wenn nichts im Titel auf ein Rechtsgebiet deutet – das einzige
 *    importierte Gesetz mit dieser Zählweise.
 * Ergänzt wird nur ein importiertes Gesetz; der gespeicherte Text bleibt unverändert.
 */
export type NormSign = "§" | "Art.";

const AREAS: { re: RegExp; law: string }[] = [
  { re: /\bBGB\b|zivilrecht|bürgerliche[sn]? recht|schuldrecht|sachenrecht|vertragsrecht|familienrecht|erbrecht|kaufrecht|deliktsrecht/i, law: "BGB" },
  { re: /\bStGB\b|strafrecht/i, law: "StGB" },
  { re: /\bStPO\b|strafprozess/i, law: "StPO" },
  { re: /\bZPO\b|zivilprozess/i, law: "ZPO" },
  { re: /\bHGB\b|handelsrecht/i, law: "HGB" },
  { re: /\bGG\b|staatsrecht|staatsorganisation|grundrechte|verfassungsrecht/i, law: "GG" },
  { re: /\bVwGO\b|verwaltungsprozess/i, law: "VwGO" },
  { re: /\bVwVfG\b|verwaltungsverfahren|allgemeines verwaltungsrecht/i, law: "VwVfG" },
];

const ART_LAWS = /^(GG|EGBGB|GRCh|EMRK|AEUV|EUV|DSGVO|BayVerf|.*Verf)$/i;
export const signOfLaw = (law: string): NormSign => (ART_LAWS.test(law) ? "Art." : "§");

export type DefaultLaws = Record<NormSign, string>;

/** `titles`: Notiz zuerst, dann die übergeordneten Ebenen; `imported`: Abkürzungen der importierten Gesetze. */
export function defaultLaws(titles: string[], imported: string[]): DefaultLaws {
  const out: DefaultLaws = { "§": "", "Art.": "" };
  const hinted: Record<NormSign, boolean> = { "§": false, "Art.": false };
  const have = new Map(imported.filter(Boolean).map((a) => [a.toLowerCase(), a]));
  for (const t of titles) {
    // Abkürzung eines importierten Gesetzes im Titel („Übung zum HGB“)
    for (const [lc, abbr] of have) {
      const sign = signOfLaw(abbr);
      if (!out[sign] && new RegExp(`(^|[^\\wÄÖÜäöü])${lc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\wÄÖÜäöü])`, "i").test(t)) out[sign] = abbr;
    }
    for (const a of AREAS) {
      if (!a.re.test(t)) continue;
      const sign = signOfLaw(a.law);
      hinted[sign] = true;
      if (!out[sign] && have.has(a.law.toLowerCase())) out[sign] = have.get(a.law.toLowerCase())!;
    }
  }
  for (const sign of ["§", "Art."] as NormSign[]) {
    if (out[sign] || hinted[sign]) continue;
    const only = [...have.values()].filter((a) => signOfLaw(a) === sign);
    if (only.length === 1) out[sign] = only[0]!;
  }
  return out;
}
