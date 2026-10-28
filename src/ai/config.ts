/** Einstellungen des KI-Assistenten an einer Stelle. */

export type Effort = "low" | "medium" | "high";
export type AiProfileId = "auto" | "genau" | "sparsam" | "guenstig";

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
 * Wahl zwischen Qualität und Kosten. „Automatisch“ ist der Standard und wählt
 * je Aufgabe das günstigste passende Modell (siehe `routeProfile`); „Genau“
 * nutzt immer Claude Opus 5.5 (siehe `cost.ts` für die Preise).
 */
export const AI_PROFILES: Record<AiProfileId, AiProfile> = {
  auto: {
    id: "auto",
    label: "Automatisch",
    hint: "Empfohlen: je Aufgabe das günstigste passende Modell – Claude Haiku 5.5 für Karteikarten und Lernskripte, Claude Sonnet 5.5 für Fragen, Übungsfälle und Korrekturen",
    model: "claude-sonnet-5-5",
    effort: "medium",
    fallback: true,
  },
  genau: { id: "genau", label: "Genau", hint: "Claude Opus 5.5 – beste Qualität für Rechtsfragen, Gutachten und Korrekturen", model: "claude-opus-5-5", effort: "high", fallback: true },
  sparsam: { id: "sparsam", label: "Sparsam", hint: "Claude Sonnet 5.5 – etwa halb so teuer, für die meisten Fragen gut genug", model: "claude-sonnet-5-5", effort: "medium", fallback: true },
  guenstig: { id: "guenstig", label: "Sehr günstig", hint: "Claude Haiku 5.5 – rund 40-mal günstiger; gut für Karteikarten, schwächer bei kniffligen Fällen", model: "claude-haiku-5-5", effort: "medium", fallback: false },
};
export const DEFAULT_PROFILE: AiProfileId = "auto";
/** Einstellung, unter der die Wahl gespeichert wird */
export const PROFILE_SETTING = "ai.profile";

export function profileFromSettings(v: unknown): AiProfile {
  return AI_PROFILES[(typeof v === "string" && v in AI_PROFILES ? v : DEFAULT_PROFILE) as AiProfileId];
}

/** Aufgaben, für die „Automatisch“ ein Modell wählt. */
export type AiRoute = "assistent" | "aufbereiten" | "karteikarten" | "uebungsfall" | "korrektur";

/**
 * „Automatisch“: einfache Lernhilfen (Karteikarten, Lernskript) laufen auf
 * Claude Haiku 5.5, Fragen und Übungsfälle auf Claude Sonnet 5.5, die
 * Korrektur einer Lösung auf Claude Sonnet 5.5 mit mehr Denktiefe. Jede
 * andere Wahl gilt unverändert für alle Aufgaben.
 */
export function routeProfile(p: AiProfile, route: AiRoute): AiProfile {
  if (p.id !== "auto") return p;
  if (route === "karteikarten" || route === "aufbereiten") return { ...AI_PROFILES.guenstig, id: "auto" };
  if (route === "korrektur") return { ...AI_PROFILES.sparsam, id: "auto", effort: "high" };
  return { ...AI_PROFILES.sparsam, id: "auto" };
}

/** Modell: Claude Opus 5.5 (bei „Genau“). */
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
