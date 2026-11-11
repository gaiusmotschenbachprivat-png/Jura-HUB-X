/**
 * Kartentypen für das Lernen im Jurastudium. Ein Eintrag („Notiz“) kann
 * mehrere Karten ergeben: „Basis + umgekehrt“ zwei, ein Lückentext je Lücke
 * ({{c1::…}}, {{c2::…}}) eine. Felder außer Vorder-/Rückseite liegen als
 * JSON in `fields`.
 */
import type { Card, CardKind, CardTemplate, NewCard } from "../api/types";

export interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
}

export interface TemplateDef {
  id: CardTemplate;
  label: string;
  hint: string;
  /** Beschriftung von Vorder- und Rückseite im Editor */
  front: string;
  back: string;
  /** Rückseite nötig? (Lückentext: nein) */
  needsBack: boolean;
  extra: FieldDef[];
  kind: CardKind;
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: "definition",
    label: "Definition",
    hint: "Begriff → Definition, mit Norm, Beispiel und Merksatz",
    front: "Begriff",
    back: "Definition",
    needsBack: true,
    kind: "definition",
    extra: [
      { key: "norm", label: "Norm / Fundstelle", placeholder: "z. B. § 90 BGB, BGHZ 1, 1" },
      { key: "beispiel", label: "Beispiel", multiline: true },
      { key: "abgrenzung", label: "Abgrenzung", placeholder: "z. B. Abgrenzung zum Besitz", multiline: true },
      { key: "merke", label: "Merke", multiline: true },
    ],
  },
  {
    id: "schema",
    label: "Prüfungsschema",
    hint: "Schema-Name → Prüfungspunkte (eine Zeile je Punkt, Einrückung mit Leerzeichen oder „-“)",
    front: "Schema / Anspruchsgrundlage",
    back: "Prüfungspunkte",
    needsBack: true,
    kind: "norm",
    extra: [
      { key: "norm", label: "Norm", placeholder: "z. B. § 823 Abs. 1 BGB" },
      { key: "merke", label: "Klausurhinweis", multiline: true },
    ],
  },
  {
    id: "begriff",
    label: "Begriffserklärung",
    hint: "Begriff → Erklärung in eigenen Worten",
    front: "Begriff",
    back: "Erklärung",
    needsBack: true,
    kind: "definition",
    extra: [
      { key: "beispiel", label: "Beispiel", multiline: true },
      { key: "kontext", label: "Wo kommt das vor?", placeholder: "z. B. Rechtsgeschäftslehre, Anfechtung" },
    ],
  },
  {
    id: "basis",
    label: "Frage – Antwort",
    hint: "Eine Frage, eine Antwort",
    front: "Frage",
    back: "Antwort",
    needsBack: true,
    kind: "frage",
    extra: [{ key: "norm", label: "Norm / Fundstelle" }],
  },
  {
    id: "umgekehrt",
    label: "Frage – Antwort + umgekehrt",
    hint: "Zwei Karten: vorwärts und rückwärts (z. B. Norm ↔ Inhalt)",
    front: "Vorderseite",
    back: "Rückseite",
    needsBack: true,
    kind: "frage",
    extra: [],
  },
  {
    id: "luecke",
    label: "Lückentext",
    hint: "Lücken mit {{c1::Text}} markieren – je Nummer eine Karte; Hinweis: {{c1::Text::Hinweis}}",
    front: "Text mit Lücken",
    back: "Zusatz (optional)",
    needsBack: false,
    kind: "frage",
    extra: [{ key: "norm", label: "Norm / Fundstelle" }],
  },
  {
    id: "eingabe",
    label: "Antwort eintippen",
    hint: "Die Antwort wird eingetippt und mit der Lösung verglichen (gut für Normen und Fachbegriffe)",
    front: "Frage",
    back: "Erwartete Antwort",
    needsBack: true,
    kind: "frage",
    extra: [{ key: "norm", label: "Norm / Fundstelle" }],
  },
];

export const templateDef = (id: string | undefined): TemplateDef => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES.find((t) => t.id === "basis")!;

export function parseFields(json: string | undefined | null): Record<string, string> {
  try {
    const v = JSON.parse(json || "{}") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

// ---------- Lückentext ----------

const CLOZE = /\{\{c(\d{1,2})::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/** Nummern der Lücken (sortiert, ohne Doppel) */
export function clozeNumbers(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(CLOZE)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 99) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export type ClozePart = { text: string; kind: "plain" | "gap" | "answer" | "other"; hint?: string };

/**
 * Teile eines Lückentexts für Karte `ord`: die eigene Lücke als Lücke (Frage)
 * bzw. hervorgehobene Antwort, andere Lücken als normaler Text.
 */
export function clozeParts(text: string, ord: number, revealed: boolean): ClozePart[] {
  const out: ClozePart[] = [];
  let last = 0;
  for (const m of text.matchAll(CLOZE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), kind: "plain" });
    const n = Number(m[1]);
    if (n === ord) out.push(revealed ? { text: m[2]!, kind: "answer" } : { text: m[3] ? m[3] : "…", kind: "gap", hint: m[3] });
    else out.push({ text: m[2]!, kind: "other" });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: "plain" });
  return out;
}

/** Lückentext ohne Markierung (für Suche und Rückseite) */
export const clozePlain = (text: string) => text.replace(CLOZE, (_m, _n, a: string) => a);

// ---------- Eintrag → Karten ----------

export interface NoteInput {
  template: CardTemplate;
  front: string;
  back: string;
  fields: Record<string, string>;
  deck: string;
  tags: string;
  area_id: string | null;
  node_id?: string | null;
  source_type?: NewCard["source_type"];
  source_id?: string | null;
}

/** Karten, die ein Eintrag ergibt (gemeinsamer note_key, wenn es mehrere sind). */
export function cardsForNote(n: NoteInput, noteKey: () => string): NewCard[] {
  const def = templateDef(n.template);
  const base: NewCard = {
    area_id: n.area_id,
    node_id: n.node_id ?? null,
    kind: def.kind,
    template: n.template,
    deck: n.deck,
    tags: n.tags,
    fields: JSON.stringify(cleanFieldValues(n.fields)),
    front: n.front.trim(),
    back: n.back.trim(),
    source_type: n.source_type ?? null,
    source_id: n.source_id ?? null,
  };
  if (n.template === "luecke") {
    const nums = clozeNumbers(n.front);
    const key = nums.length > 1 ? noteKey() : null;
    return nums.map((ord) => ({ ...base, back: n.back.trim() || clozePlain(n.front).trim(), note_key: key, ord }));
  }
  if (n.template === "umgekehrt") {
    const key = noteKey();
    return [
      { ...base, note_key: key, ord: 0 },
      { ...base, note_key: key, ord: 1 },
    ];
  }
  return [base];
}

const cleanFieldValues = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));

/** Prüfen vor dem Speichern: Fehlermeldung oder null */
export function noteProblem(n: Pick<NoteInput, "template" | "front" | "back">): string | null {
  const def = templateDef(n.template);
  if (!n.front.trim()) return `Bitte „${def.front}“ ausfüllen.`;
  if (n.template === "luecke" && !clozeNumbers(n.front).length) return "Im Lückentext fehlt eine Lücke – Text markieren und „Lücke“ tippen oder {{c1::…}} schreiben.";
  if (def.needsBack && !n.back.trim()) return `Bitte „${def.back}“ ausfüllen.`;
  return null;
}

/** Was eine Karte auf der Vorderseite zeigt (für Listen) */
export function cardQuestion(c: Pick<Card, "template" | "front" | "back" | "ord">): string {
  if (c.template === "luecke") return clozeParts(c.front, c.ord, false).map((p) => (p.kind === "gap" ? `[${p.hint ?? "…"}]` : p.text)).join("");
  if (c.template === "umgekehrt" && c.ord === 1) return c.back;
  return c.front;
}

/** Schema-Text → Prüfungspunkte mit Ebene (Einrückung mit Leerzeichen/Tab oder „-“, „–“, „•“) */
export function schemaPoints(text: string): { level: number; text: string }[] {
  return text
    .split("\n")
    .map((line) => {
      const m = /^([ \t]*)((?:[-–•*]\s*)*)(.*)$/.exec(line)!;
      const indent = m[1]!.replace(/\t/g, "  ").length;
      const dashes = (m[2]!.match(/[-–•*]/g) ?? []).length;
      return { level: Math.floor(indent / 2) + Math.max(0, dashes - 1), text: m[3]!.trim() };
    })
    .filter((p) => p.text !== "");
}
