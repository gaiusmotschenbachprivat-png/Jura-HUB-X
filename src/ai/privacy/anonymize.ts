/**
 * Anonymisierung vor dem Aufruf der Claude API.
 *
 * Erkannte personenbezogene Angaben werden durch Platzhalter wie `[PERSON_1]`
 * ersetzt. Dieselbe Angabe erhält in einer Unterhaltung immer denselben
 * Platzhalter. Die Zuordnung bleibt nur im Arbeitsspeicher und wird nach der
 * Antwort zum Zurückübersetzen genutzt.
 *
 * Grenzen (ehrlich): Musterbasierte Erkennung findet nicht jeden Namen. Namen
 * von Beteiligten deshalb zusätzlich in „Eigene Begriffe“ eintragen.
 * Fallbuchstaben wie „A“, „B“, „V“, „K“ bleiben bewusst erhalten.
 */

export type Category = "person" | "email" | "telefon" | "iban" | "adresse" | "geburtsdatum" | "aktenzeichen_eigen";

export interface AnonymizeConfig {
  enabled: boolean;
  categories: Record<Category, boolean>;
  /** Eigene Begriffe (z. B. Namen von Mandanten), immer ersetzt */
  customTerms: string[];
}

export const DEFAULT_CONFIG: AnonymizeConfig = {
  enabled: true,
  categories: { person: true, email: true, telefon: true, iban: true, adresse: true, geburtsdatum: true, aktenzeichen_eigen: false },
  customTerms: [],
};

const LABEL: Record<Category | "eigen", string> = {
  person: "PERSON",
  email: "EMAIL",
  telefon: "TELEFON",
  iban: "IBAN",
  adresse: "ADRESSE",
  geburtsdatum: "GEBURTSDATUM",
  aktenzeichen_eigen: "AKTENZEICHEN",
  eigen: "BEGRIFF",
};

const NAME = "[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?";
const PATTERNS: [Category, RegExp][] = [
  ["email", /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g],
  ["iban", /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g],
  ["telefon", /(?:\+49|0049|\b0)[1-9][\d\s/()-]{5,}\d\b/g],
  ["geburtsdatum", /\b(?:geb\.|geboren)\s*(?:am\s*)?\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}/gi],
  [
    "adresse",
    new RegExp(
      `\\b${NAME}(?:straße|strasse|str\\.|weg|platz|allee|gasse|ring|damm|ufer|steig|pfad)\\s+\\d+\\s?[a-z]?\\b|\\b\\d{5}\\s+${NAME}(?:\\s${NAME})?`,
      "g",
    ),
  ],
  // „Herr Müller“, „Frau Dr. Schmidt“, „Rechtsanwältin Weber“ – Name nach Anrede/Titel
  [
    "person",
    new RegExp(`\\b(?:Herrn?|Frau|Dr\\.|Prof\\.|Rechtsanwalt|Rechtsanwältin|RA|RAin|Mandant(?:in)?)\\s+(?:(?:Dr|Prof)\\.\\s+)?(${NAME}(?:\\s${NAME})?)`, "g"),
  ],
  // eigene Aktenzeichen der Kanzlei/Akte, z. B. „Az. 123/26“ (Gerichtsaktenzeichen bleiben erhalten)
  ["aktenzeichen_eigen", /\b(?:Unser|Ihr)\s+Az\.?:?\s*[\w/.-]+/gi],
];

export class Anonymizer {
  private byValue = new Map<string, string>();
  private byToken = new Map<string, string>();
  private counters = new Map<string, number>();

  constructor(private config: AnonymizeConfig = DEFAULT_CONFIG) {}

  private token(kind: Category | "eigen", value: string): string {
    const key = value.trim();
    const existing = this.byValue.get(key);
    if (existing) return existing;
    const label = LABEL[kind];
    const n = (this.counters.get(label) ?? 0) + 1;
    this.counters.set(label, n);
    const t = `[${label}_${n}]`;
    this.byValue.set(key, t);
    this.byToken.set(t, key);
    return t;
  }

  /** Ersetzt erkannte Angaben durch Platzhalter. */
  anonymize(text: string): string {
    if (!this.config.enabled || !text) return text;
    let out = text;
    // Bereits bekannte Werte (auch aus früheren Nachrichten) zuerst
    const custom = [...this.config.customTerms, ...this.byValue.keys()]
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
      .sort((a, b) => b.length - a.length);
    for (const term of custom) {
      const re = new RegExp(`(?<![\\wÄÖÜäöüß])${escape(term)}(?![\\wÄÖÜäöüß])`, "g");
      out = out.replace(re, (m) => this.byValue.get(m.trim()) ?? this.token("eigen", m));
    }
    for (const [cat, re] of PATTERNS) {
      if (!this.config.categories[cat]) continue;
      re.lastIndex = 0;
      out = out.replace(re, (match: string, name?: string) => {
        if (cat === "person" && name) return match.replace(name, this.token("person", name));
        return this.token(cat, match);
      });
    }
    return out;
  }

  /** Setzt die Originalangaben wieder ein (für die Anzeige). */
  deanonymize(text: string): string {
    return text.replace(/\[(?:PERSON|EMAIL|TELEFON|IBAN|ADRESSE|GEBURTSDATUM|AKTENZEICHEN|BEGRIFF)_\d+\]/g, (t) => this.byToken.get(t) ?? t);
  }

  /** Anzahl der ersetzten Angaben (für die Anzeige „3 Angaben anonymisiert“). */
  get count(): number {
    return this.byToken.size;
  }
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Konfiguration aus den gespeicherten Einstellungen lesen (unbekannte Werte → Standard). */
export function configFromSettings(v: unknown): AnonymizeConfig {
  if (!v || typeof v !== "object") return DEFAULT_CONFIG;
  const o = v as Partial<AnonymizeConfig>;
  return {
    enabled: o.enabled !== false,
    categories: { ...DEFAULT_CONFIG.categories, ...(o.categories ?? {}) },
    customTerms: Array.isArray(o.customTerms) ? o.customTerms.filter((t): t is string => typeof t === "string").slice(0, 200) : [],
  };
}
