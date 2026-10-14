/** Einstellungen des KI-Assistenten an einer Stelle. */

/** Modell: Claude Opus 5.5 (Standard). */
export const MODEL = "claude-opus-5-5";
/** Denktiefe; juristische Prüfungen profitieren von „high“. */
export const EFFORT = "high" as const;
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
/** Schlusshinweis, den jede Antwort trägt. */
export const DISCLAIMER = "Hinweis: Diese Ausgabe ersetzt keine anwaltliche Prüfung im Einzelfall.";
