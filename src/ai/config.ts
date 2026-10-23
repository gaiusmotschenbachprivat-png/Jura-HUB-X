/** Einstellungen des KI-Assistenten an einer Stelle. */

export type Effort = "low" | "medium" | "high";
export type AiProfileId = "genau" | "sparsam" | "guenstig";

export interface AiProfile {
  id: AiProfileId;
  label: string;
  /** Kurzbeschreibung für die Auswahl */
  hint: string;
  model: string;
  effort: Effort;
  /** Serverseitiges Ausweichmodell bei Ablehnung (Claude Haiku 5.5 hat keins) */
  fallback: boolean;
}

/**
 * Wahl zwischen Qualität und Kosten. „Genau“ ist der Standard; „Sparsam“ und
 * „Sehr günstig“ strecken das Guthaben (siehe `cost.ts` für die Preise).
 */
export const AI_PROFILES: Record<AiProfileId, AiProfile> = {
  genau: { id: "genau", label: "Genau", hint: "Claude Opus 5.5 – beste Qualität für Rechtsfragen, Gutachten und Korrekturen", model: "claude-opus-5-5", effort: "high", fallback: true },
  sparsam: { id: "sparsam", label: "Sparsam", hint: "Claude Sonnet 5.5 – etwa halb so teuer, für die meisten Fragen gut genug", model: "claude-sonnet-5-5", effort: "medium", fallback: true },
  guenstig: { id: "guenstig", label: "Sehr günstig", hint: "Claude Haiku 5.5 – rund 40-mal günstiger; gut für Karteikarten, schwächer bei kniffligen Fällen", model: "claude-haiku-5-5", effort: "medium", fallback: false },
};
export const DEFAULT_PROFILE: AiProfileId = "genau";
/** Einstellung, unter der die Wahl gespeichert wird */
export const PROFILE_SETTING = "ai.profile";

export function profileFromSettings(v: unknown): AiProfile {
  return AI_PROFILES[(typeof v === "string" && v in AI_PROFILES ? v : DEFAULT_PROFILE) as AiProfileId];
}

/** Modell: Claude Opus 5.5 (Standard). */
export const MODEL = AI_PROFILES.genau.model;
/** Denktiefe des Standards; juristische Prüfungen profitieren von „high“. */
export const EFFORT = AI_PROFILES.genau.effort;
/** Höchstlänge einer Antwort (ohne Streaming; reicht für ausführliche Gutachten). */
export const MAX_TOKENS = 16000;
/** Höchstzahl an Runden mit Werkzeugaufrufen je Frage. */
export const MAX_TOOL_ROUNDS = 8;
/** Überarbeitungsrunden, wenn Zitate nicht belegt sind. */
export const MAX_REVISIONS = 1;
/** Anzahl der vorab abgerufenen Quellenabschnitte. */
export const RETRIEVAL_LIMIT = 8;
/** Bei Ablehnung durch Sicherheitsfilter: Anthropics empfohlenes Ausweichmodell (serverseitig). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Modellabhängiger Teil einer Anfrage (Modell, Denktiefe, Ausweichmodell). */
export function profileParams(p: AiProfile) {
  return {
    model: p.model,
    effort: p.effort,
    // Claude Haiku 5.5 kennt kein serverseitiges Ausweichen – dort weglassen
    extra: p.fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {},
  };
}
/** Schlusshinweis, den jede Antwort trägt. */
export const DISCLAIMER = "Hinweis: Diese Ausgabe ersetzt keine anwaltliche Prüfung im Einzelfall.";
