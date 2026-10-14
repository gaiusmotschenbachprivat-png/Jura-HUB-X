import type { KnowledgeType, SourceKind } from "../../api/types";

export const TYPE_LABEL: Record<KnowledgeType, string> = {
  definition: "Definition",
  schema: "Prüfungsschema",
  case: "Fall",
  citation: "Fundstelle",
};

export const TYPE_LABEL_PLURAL: Record<KnowledgeType, string> = {
  definition: "Definitionen",
  schema: "Prüfungsschemata",
  case: "Fälle",
  citation: "Fundstellen",
};

export const TYPE_HINT: Record<KnowledgeType, string> = {
  definition: "Begriffe mit Definition, Fundstelle, Quelle und Beispiel. Aus Notizen verlinkbar; Rückverweise zeigen, wo eine Definition verwendet wird.",
  schema: "Mehrstufige Prüfungsschemata mit juristischer Gliederung (A. I. 1. a) aa)). Ein Schema ist eine Arbeitshilfe, keine allgemeingültige Vorgabe.",
  case: "Fälle mit Sachverhalt, Fallfrage und Lösung im Gutachtenstil – sortierbar nach Rechtsgebiet, Anspruchsgrundlage und Schwierigkeit.",
  citation: "Gesetzesfundstellen als strukturierte Angaben (z. B. § 433 Abs. 2 BGB). Studium OS zeigt keine Gesetzestexte an und prüft keine Gesetzesstände.",
};

export const SOURCE_LABEL: Record<SourceKind, string> = {
  eigen: "Eigene Formulierung",
  vorlesung: "Aus der Vorlesung",
  lehrbuch: "Lehrbuch / Skript",
  rechtsprechung: "Rechtsprechung",
  import: "Importiert",
  "ki-vorschlag": "KI-Vorschlag (ungeprüft)",
};

/** Herkünfte, die nicht als geprüft gelten und deutlich markiert werden. */
export const UNVERIFIED: SourceKind[] = ["import", "ki-vorschlag"];

export const FIELD_SUGGESTIONS = [
  "Zivilrecht",
  "BGB AT",
  "Schuldrecht",
  "Sachenrecht",
  "Familien- und Erbrecht",
  "Handels- und Gesellschaftsrecht",
  "Arbeitsrecht",
  "Zivilprozessrecht",
  "Strafrecht",
  "Strafprozessrecht",
  "Öffentliches Recht",
  "Staatsorganisationsrecht",
  "Grundrechte",
  "Verwaltungsrecht",
  "Europarecht",
  "BWL",
  "VWL",
  "Rechnungswesen",
  "Finanzierung und Investition",
  "Statistik",
];

export const CASE_STATUS: Record<string, string> = {
  offen: "Offen",
  bearbeitet: "Bearbeitet",
  wiederholen: "Wiederholen",
};

export const DIFFICULTY: Record<number, string> = { 0: "–", 1: "Leicht", 2: "Mittel", 3: "Schwer" };
