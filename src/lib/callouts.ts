/**
 * Arten der farbigen Kästen im Skript (Beispiel, Gesetzestext, Definition …).
 * Unabhängig vom Editor, damit Exporte (Word, Markdown, Druck) dieselben
 * Bezeichnungen und Farben verwenden.
 *
 * Die mitgelieferten Arten lassen sich umbenennen und umfärben, eigene Arten
 * kommen hinzu (Einstellung `editor.callouts`). Ein Kasten einer eigenen Art
 * trägt Bezeichnung und Farbe zusätzlich selbst (`label`, `color`), damit er
 * auch auf einem anderen Gerät oder nach dem Löschen der Art richtig aussieht.
 */
export type CalloutKind = string;

export interface CalloutInfo {
  kind: CalloutKind;
  label: string;
  /** Akzentfarbe (Rand, Beschriftung) */
  color: string;
  /** sehr helle Hinterlegung für Word/Druck */
  fill: string;
  /** eigene Art (nicht mitgeliefert) */
  custom?: boolean;
}

export const CALLOUTS: CalloutInfo[] = [
  { kind: "beispiel", label: "Beispiel", color: "#2f5fb3", fill: "EEF3FB" },
  { kind: "erklaerung", label: "Erklärung", color: "#1f7a85", fill: "EAF4F5" },
  { kind: "gesetz", label: "Gesetzestext", color: "#6b4fa3", fill: "F3EFF9" },
  { kind: "definition", label: "Definition", color: "#2e7d5b", fill: "EDF6F1" },
  { kind: "fall", label: "Fall", color: "#a3354a", fill: "F9EEF0" },
  { kind: "merke", label: "Merke", color: "#a86a12", fill: "FBF4E6" },
  { kind: "problem", label: "Problem / Streitstand", color: "#b4471f", fill: "FBEFEA" },
  { kind: "hinweis", label: "Hinweis", color: "#5b6676", fill: "F1F3F6" },
];

const BUILTIN = new Map(CALLOUTS.map((c) => [c.kind, c]));

/** Gespeicherte Anpassungen (Einstellung `editor.callouts`). */
export interface CalloutConfig {
  /** mitgelieferte Arten: andere Bezeichnung oder Farbe */
  overrides: Record<string, { label?: string; color?: string }>;
  /** eigene Arten */
  extra: { kind: string; label: string; color: string }[];
}

export const CALLOUT_SETTING = "editor.callouts";
export const CALLOUTS_CHANGED = "studium:callouts-changed";

const COLOR = /^#[0-9a-f]{6}$/i;
const cleanLabel = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 40) : "");
const cleanColor = (s: unknown) => (typeof s === "string" && COLOR.test(s.trim()) ? s.trim().toLowerCase() : "");

/** Einstellung prüfen und bereinigen (fremde Werte werden verworfen). */
export function parseCalloutConfig(v: unknown): CalloutConfig {
  const o = v && typeof v === "object" ? (v as Partial<CalloutConfig>) : {};
  const overrides: CalloutConfig["overrides"] = {};
  for (const [k, ov] of Object.entries(o.overrides && typeof o.overrides === "object" ? o.overrides : {})) {
    if (!BUILTIN.has(k) || !ov || typeof ov !== "object") continue;
    const label = cleanLabel(ov.label);
    const color = cleanColor(ov.color);
    if (label || color) overrides[k] = { ...(label ? { label } : {}), ...(color ? { color } : {}) };
  }
  const extra = (Array.isArray(o.extra) ? o.extra : [])
    .map((e) => ({ kind: typeof e?.kind === "string" && /^eigen-[a-z0-9-]{1,40}$/.test(e.kind) ? e.kind : "", label: cleanLabel(e?.label), color: cleanColor(e?.color) }))
    .filter((e) => e.kind && e.label && e.color)
    .slice(0, 30);
  return { overrides, extra };
}

let config: CalloutConfig = { overrides: {}, extra: [] };

export function setCalloutConfig(c: CalloutConfig) {
  config = parseCalloutConfig(c);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CALLOUTS_CHANGED));
}
export const calloutConfig = () => config;

/** Sehr helle Hinterlegung (7 % Farbe auf Weiß) als Hex ohne „#“. */
export function fillFor(color: string): string {
  const n = parseInt(color.slice(1), 16);
  const mix = (c: number) => Math.round(255 - (255 - c) * 0.07);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("").toUpperCase();
}

const make = (kind: string, label: string, color: string, custom: boolean): CalloutInfo => ({ kind, label, color, fill: fillFor(color), custom });

/** Alle Arten zur Auswahl: mitgelieferte (mit Anpassungen), dann eigene. */
export function calloutKinds(): CalloutInfo[] {
  return [
    ...CALLOUTS.map((c) => {
      const ov = config.overrides[c.kind];
      return ov ? make(c.kind, ov.label || c.label, ov.color || c.color, false) : c;
    }),
    ...config.extra.map((e) => make(e.kind, e.label, e.color, true)),
  ];
}

/**
 * Art eines Kastens. `snapshot` sind Bezeichnung/Farbe, die ein Kasten einer
 * eigenen Art selbst trägt – gilt, wenn die Art hier (noch) nicht bekannt ist.
 */
export function calloutInfo(kind: unknown, snapshot?: { label?: unknown; color?: unknown }): CalloutInfo {
  const k = typeof kind === "string" ? kind : "";
  const known = calloutKinds().find((c) => c.kind === k);
  if (known) return known;
  const label = cleanLabel(snapshot?.label);
  const color = cleanColor(snapshot?.color);
  if (k.startsWith("eigen-") && label && color) return make(k, label, color, true);
  return calloutKinds()[0]!;
}

/** Beschriftung oben im Kasten, z. B. „Gesetzestext · § 433 BGB“. */
export function calloutLabel(kind: unknown, title?: unknown, snapshot?: { label?: unknown; color?: unknown }): string {
  const t = typeof title === "string" ? title.trim() : "";
  const label = calloutInfo(kind, snapshot).label;
  return t ? `${label} · ${t}` : label;
}

/** Attribute, die ein Kasten der Art `kind` mitträgt (Bezeichnung/Farbe nur bei eigenen Arten). */
export function calloutAttrs(kind: string): { kind: string; label: string; color: string } {
  const info = calloutInfo(kind);
  return info.custom ? { kind: info.kind, label: info.label, color: info.color } : { kind: info.kind, label: "", color: "" };
}

/** Kennung für eine neue eigene Art. */
export function newCalloutKind(): string {
  return `eigen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
