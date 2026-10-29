import type { NodeKind } from "../api/types";

export const KIND_LABEL: Record<NodeKind, string> = {
  semester: "Semester",
  module: "Modul / Fach",
  course: "Veranstaltung",
  session: "Vorlesungstermin",
  topic: "Thema",
  folder: "Ordner",
  note: "Notiz",
};

export const KIND_LABEL_PLURAL: Record<NodeKind, string> = {
  semester: "Semester",
  module: "Module / Fächer",
  course: "Veranstaltungen",
  session: "Vorlesungstermine",
  topic: "Themen",
  folder: "Ordner",
  note: "Notizen",
};

/** Sinnvolle Vorschläge für neue Unterelemente. Andere sind trotzdem erlaubt. */
export const SUGGESTED_CHILDREN: Record<NodeKind | "root", NodeKind[]> = {
  root: ["semester", "module", "course", "folder", "note"],
  semester: ["module", "course", "folder", "note"],
  module: ["course", "topic", "folder", "note"],
  course: ["session", "topic", "folder", "note"],
  session: ["topic", "note", "folder"],
  topic: ["topic", "note", "folder"],
  folder: ["folder", "note", "topic"],
  note: ["note"],
};

export const ALL_KINDS: NodeKind[] = ["semester", "module", "course", "session", "topic", "folder", "note"];

export const DOC_TYPE_LABEL: Record<string, string> = {
  folien: "Vorlesungsfolien",
  skript: "Skript",
  uebungsblatt: "Übungsblatt",
  loesung: "Lösung",
  mitschrift: "Mitschrift",
  gesetz: "Gesetzestext",
  aufsatz: "Aufsatz",
  urteil: "Urteil",
  klausur: "Klausur",
  aufnahme: "Vorlesungsaufnahme",
  sonstiges: "Sonstiges",
};

export const TEXT_STATUS_LABEL: Record<string, string> = {
  pending: "Text wird ausgelesen …",
  ok: "Text durchsuchbar",
  none: "Kein Text gefunden (z. B. Scan)",
  unsupported: "Text nicht auslesbar (Format)",
  error: "Text konnte nicht gelesen werden",
};

export const AREA_COLORS = ["#2f4a8a", "#2e7d5b", "#9a5b13", "#7a3e8f", "#a3354a", "#2b7a8c", "#5b6170"];
