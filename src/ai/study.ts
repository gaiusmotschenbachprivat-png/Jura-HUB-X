/**
 * KI-Lernhilfen: Mitschrift aufbereiten, Karteikarten vorschlagen,
 * Übungsfall erstellen und Lösung besprechen. Ein Aufruf je Aktion, die
 * Unterlagen werden vorher anonymisiert und das Ergebnis zurückübersetzt.
 */
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import aufbereiten from "../../prompts/lernen/aufbereiten.md?raw";
import karteikarten from "../../prompts/lernen/karteikarten.md?raw";
import korrektur from "../../prompts/lernen/korrektur.md?raw";
import studySystem from "../../prompts/lernen/system.md?raw";
import uebungsfall from "../../prompts/lernen/uebungsfall.md?raw";
import { textOf } from "./assistant";
import type { LlmClient } from "./client";
import { AI_PROFILES, type AiProfile, MAX_TOKENS, profileParams, routeProfile } from "./config";
import { requestCostUsd } from "./cost";
import { Anonymizer } from "./privacy/anonymize";

export type StudyTask = "aufbereiten" | "karteikarten" | "uebungsfall" | "korrektur";
export const STUDY_PROMPTS: Record<StudyTask, string> = { aufbereiten, karteikarten, uebungsfall, korrektur };

/** Höchstlänge der mitgeschickten Unterlagen (Zeichen). */
export const MAX_MATERIAL = 150_000;

export const CARD_SCHEMA = {
  type: "object",
  properties: {
    karten: {
      type: "array",
      items: {
        type: "object",
        properties: {
          art: { type: "string", enum: ["definition", "frage", "norm"] },
          vorderseite: { type: "string" },
          rueckseite: { type: "string" },
        },
        required: ["art", "vorderseite", "rueckseite"],
        additionalProperties: false,
      },
    },
  },
  required: ["karten"],
  additionalProperties: false,
} as const;

export const CASE_SCHEMA = {
  type: "object",
  properties: {
    titel: { type: "string" },
    sachverhalt: { type: "string" },
    fallfrage: { type: "string" },
    bearbeitungshinweis: { type: "string" },
    loesungsskizze: { type: "string" },
  },
  required: ["titel", "sachverhalt", "fallfrage", "bearbeitungshinweis", "loesungsskizze"],
  additionalProperties: false,
} as const;

export interface CardSuggestion {
  kind: "definition" | "frage" | "norm";
  front: string;
  back: string;
}

export interface TrainingCase {
  title: string;
  facts: string;
  question: string;
  hint: string;
  sketch: string;
}

export interface StudyResult<T> {
  value: T;
  /** Was an Anthropic ging (anonymisiert) – zur Anzeige */
  sent: string;
  model: string;
  anonymized: number;
  /** geschätzte Kosten in US-Dollar */
  costUsd: number;
}

export interface StudyOptions {
  llm: LlmClient;
  anonymizer?: Anonymizer;
  profile?: AiProfile;
  /** nur für Tests: anderes Modell erzwingen */
  model?: string;
}

async function call(o: StudyOptions, task: StudyTask, user: string, schema?: Record<string, unknown>) {
  const p = profileParams(routeProfile(o.profile ?? AI_PROFILES.auto, task));
  const params: MessageCreateParamsNonStreaming = {
    model: o.model ?? p.model,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text", text: studySystem.trim() },
      { type: "text", text: STUDY_PROMPTS[task].trim(), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: user }],
    output_config: schema ? { effort: p.effort, format: { type: "json_schema", schema } } : { effort: p.effort },
    ...p.extra,
  };
  const res = await o.llm.create(params);
  if (res.stop_reason === "refusal") throw new Error("Claude hat diese Anfrage abgelehnt.");
  if (res.stop_reason === "max_tokens") throw new Error("Die Antwort wurde zu lang und ist abgeschnitten. Bitte mit weniger Stoff erneut versuchen.");
  return { text: textOf(res), model: res.model, costUsd: requestCostUsd(res.model, res.usage) };
}

function material(label: string, text: string): string {
  const t = text.trim();
  return `<${label}>\n${t.length > MAX_MATERIAL ? t.slice(0, MAX_MATERIAL) + "\n[… gekürzt]" : t}\n</${label}>`;
}

function parseJson<T>(text: string): T {
  const s = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return JSON.parse(s) as T;
}

// ---------- Eingaben und Auswertung (auch für die Claude-App-Brücke) ----------

export const notesInput = (an: Anonymizer, title: string, text: string) => material("mitschrift", an.anonymize(`Titel: ${title}\n\n${text}`));
export const cardsInput = (an: Anonymizer, title: string, text: string) => material("unterlagen", an.anonymize(`Titel: ${title}\n\n${text}`));
export const caseInput = (an: Anonymizer, title: string, text: string, difficulty: Difficulty) =>
  `Schwierigkeit: ${DIFF[difficulty]}\n\n${material("unterlagen", an.anonymize(`Titel: ${title}\n\n${text}`))}`;
export const reviewInput = (an: Anonymizer, c: { facts: string; question: string; sketch: string }, solution: string) =>
  [
    material("sachverhalt", an.anonymize(c.facts)),
    material("fallfrage", an.anonymize(c.question)),
    material("loesungsskizze_nur_fuer_dich", an.anonymize(c.sketch)),
    material("loesung", an.anonymize(solution)),
  ].join("\n\n");

export function parseCards(text: string, an: Anonymizer): CardSuggestion[] {
  const data = parseJson<{ karten?: { art: string; vorderseite: string; rueckseite: string }[] }>(text);
  return (data.karten ?? [])
    .filter((k) => k.vorderseite?.trim() && k.rueckseite?.trim())
    .map((k) => ({
      kind: (["definition", "frage", "norm"].includes(k.art) ? k.art : "frage") as CardSuggestion["kind"],
      front: an.deanonymize(k.vorderseite.trim()),
      back: an.deanonymize(k.rueckseite.trim()),
    }));
}

export function parseCase(text: string, an: Anonymizer): TrainingCase {
  const d = parseJson<Record<string, string>>(text);
  const v = (k: string) => an.deanonymize(String(d[k] ?? "").trim());
  const c = { title: v("titel"), facts: v("sachverhalt"), question: v("fallfrage"), hint: v("bearbeitungshinweis"), sketch: v("loesungsskizze") };
  if (!c.facts || !c.question) throw new Error("Die Antwort enthält keinen vollständigen Übungsfall (Sachverhalt und Fallfrage fehlen).");
  return c;
}

/** Mitschrift → Lernskript (Markdown). */
export async function prepareNotes(o: StudyOptions, title: string, text: string): Promise<StudyResult<string>> {
  const an = o.anonymizer ?? new Anonymizer();
  const user = notesInput(an, title, text);
  const r = await call(o, "aufbereiten", user);
  return { value: an.deanonymize(r.text), sent: user, model: r.model, anonymized: an.count, costUsd: r.costUsd };
}

/** Unterlagen → Karteikarten-Vorschläge. */
export async function suggestCards(o: StudyOptions, title: string, text: string): Promise<StudyResult<CardSuggestion[]>> {
  const an = o.anonymizer ?? new Anonymizer();
  const user = cardsInput(an, title, text);
  const r = await call(o, "karteikarten", user, CARD_SCHEMA as unknown as Record<string, unknown>);
  return { value: parseCards(r.text, an), sent: user, model: r.model, anonymized: an.count, costUsd: r.costUsd };
}

export type Difficulty = "anfaenger" | "fortgeschritten" | "examen";
const DIFF: Record<Difficulty, string> = {
  anfaenger: "Anfänger (1.–2. Semester), ca. 1 Seite Sachverhalt, 1–2 Probleme, Bearbeitungszeit 60 Minuten",
  fortgeschritten: "Fortgeschrittene, ca. 1–1,5 Seiten, 2–3 Probleme, 120 Minuten",
  examen: "Examensniveau, ca. 2 Seiten, mehrere verschränkte Probleme, 300 Minuten",
};

/** Unterlagen → Übungsfall mit (verdeckter) Lösungsskizze. */
export async function createCase(o: StudyOptions, title: string, text: string, difficulty: Difficulty): Promise<StudyResult<TrainingCase>> {
  const an = o.anonymizer ?? new Anonymizer();
  const user = caseInput(an, title, text, difficulty);
  const r = await call(o, "uebungsfall", user, CASE_SCHEMA as unknown as Record<string, unknown>);
  return { value: parseCase(r.text, an), sent: user, model: r.model, anonymized: an.count, costUsd: r.costUsd };
}

/** Lösung → Rückmeldung (Markdown). */
export async function reviewSolution(o: StudyOptions, c: { facts: string; question: string; sketch: string }, solution: string): Promise<StudyResult<string>> {
  const an = o.anonymizer ?? new Anonymizer();
  const user = reviewInput(an, c, solution);
  const r = await call(o, "korrektur", user);
  return { value: an.deanonymize(r.text), sent: user, model: r.model, anonymized: an.count, costUsd: r.costUsd };
}
