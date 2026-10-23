/**
 * Arten der farbigen Kästen im Skript (Beispiel, Gesetzestext, Definition …).
 * Unabhängig vom Editor, damit Exporte (Word, Markdown, Druck) dieselben
 * Bezeichnungen und Farben verwenden.
 */
export type CalloutKind = "beispiel" | "gesetz" | "definition" | "fall" | "merke" | "problem" | "hinweis";

export interface CalloutInfo {
  kind: CalloutKind;
  label: string;
  /** Akzentfarbe (Rand, Beschriftung) */
  color: string;
  /** sehr helle Hinterlegung für Word/Druck */
  fill: string;
}

export const CALLOUTS: CalloutInfo[] = [
  { kind: "beispiel", label: "Beispiel", color: "#2f5fb3", fill: "EEF3FB" },
  { kind: "gesetz", label: "Gesetzestext", color: "#6b4fa3", fill: "F3EFF9" },
  { kind: "definition", label: "Definition", color: "#2e7d5b", fill: "EDF6F1" },
  { kind: "fall", label: "Fall", color: "#a3354a", fill: "F9EEF0" },
  { kind: "merke", label: "Merke", color: "#a86a12", fill: "FBF4E6" },
  { kind: "problem", label: "Problem / Streitstand", color: "#b4471f", fill: "FBEFEA" },
  { kind: "hinweis", label: "Hinweis", color: "#5b6676", fill: "F1F3F6" },
];

const BY_KIND = new Map(CALLOUTS.map((c) => [c.kind, c]));

export function calloutInfo(kind: unknown): CalloutInfo {
  return BY_KIND.get(kind as CalloutKind) ?? CALLOUTS[0]!;
}

/** Beschriftung oben im Kasten, z. B. „Gesetzestext · § 433 BGB“. */
export function calloutLabel(kind: unknown, title?: unknown): string {
  const t = typeof title === "string" ? title.trim() : "";
  return t ? `${calloutInfo(kind).label} · ${t}` : calloutInfo(kind).label;
}
