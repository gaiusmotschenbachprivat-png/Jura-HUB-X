/**
 * Schreibarten: Jede Notiz hat eine Art (Vorlesung, Zusammenfassung, Fall …).
 * Gespeichert in den Zusatzangaben des Knotens (`meta.noteType`), damit keine
 * Datenbankänderung nötig ist. Ältere Notizen ohne Angabe gelten als „Notiz“.
 */
import type { StudyNode } from "../api/types";
import { b, doc, empty, h, ol, p, tasks, ul, type PMNode } from "./pm";

export type NoteType = "vorlesung" | "zusammenfassung" | "fall" | "uebung" | "hausarbeit" | "klausur" | "notiz";

export interface NoteTypeInfo {
  id: NoteType;
  label: string;
  plural: string;
  /** Kurzer Hinweis im Anlege-Dialog. */
  hint: string;
  /** Passende Vorlage (siehe templates.ts). */
  template: string;
  color: string;
}

export const NOTE_TYPES: NoteTypeInfo[] = [
  { id: "vorlesung", label: "Vorlesung", plural: "Vorlesungen", hint: "Mitschrift eines Termins mit Datum und Nummer", template: "mitschrift", color: "#2f5fb3" },
  { id: "zusammenfassung", label: "Zusammenfassung", plural: "Zusammenfassungen", hint: "Lernstoff verdichtet, z. B. pro Thema", template: "zusammenfassung", color: "#2e7d5b" },
  { id: "fall", label: "Fall / Gutachten", plural: "Fälle & Gutachten", hint: "Sachverhalt lösen im Gutachtenstil", template: "gutachten", color: "#a3354a" },
  { id: "uebung", label: "Übung / AG", plural: "Übungen & AGs", hint: "Arbeitsgemeinschaft, Tutorium, Übungsblatt", template: "fall", color: "#9a5b13" },
  { id: "hausarbeit", label: "Hausarbeit / Seminar", plural: "Haus- & Seminararbeiten", hint: "Wissenschaftlich mit Fußnoten", template: "wissenschaftlich", color: "#7a3e8f" },
  { id: "klausur", label: "Klausurvorbereitung", plural: "Klausurvorbereitung", hint: "Prüfungsstoff, Schemata, Probeklausuren", template: "pruefungsvorbereitung", color: "#2b7a8c" },
  { id: "notiz", label: "Notiz", plural: "Notizen", hint: "Freier Text ohne feste Struktur", template: "leer", color: "#5b6170" },
];

const BY_ID = new Map(NOTE_TYPES.map((t) => [t.id, t]));

export function noteTypeInfo(id: NoteType): NoteTypeInfo {
  return BY_ID.get(id) ?? BY_ID.get("notiz")!;
}

export function noteTypeOf(node: Pick<StudyNode, "kind" | "meta">): NoteType | null {
  if (node.kind !== "note") return null;
  const t = node.meta?.noteType;
  return typeof t === "string" && BY_ID.has(t as NoteType) ? (t as NoteType) : "notiz";
}

/** ISO-Datum (JJJJ-MM-TT) → „15.10.2026“. */
export function formatDateDe(iso: unknown, short = false): string {
  if (typeof iso !== "string") return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return short ? `${m[3]}.${m[2]}.` : `${m[3]}.${m[2]}.${m[1]}`;
}

export function todayIso(d = new Date()): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

/** Nächste Vorlesungsnummer unter einem Elternknoten. */
export function nextLectureNumber(nodes: StudyNode[], parentId: string | null, areaId: string): number {
  const nums = nodes
    .filter((n) => n.parent_id === parentId && n.area_id === areaId && !n.deleted_at && noteTypeOf(n) === "vorlesung")
    .map((n) => Number(n.meta?.number))
    .filter((x) => Number.isFinite(x));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

export function lectureTitle(nr: number | null, topic: string): string {
  const head = nr ? `${nr}. Vorlesung` : "Vorlesung";
  return topic.trim() ? `${head}: ${topic.trim()}` : head;
}

/** Inhalt einer neuen Vorlesungsmitschrift mit den eingegebenen Angaben. */
export function lectureDoc(o: { title: string; date: string; lecturer?: string; course?: string }): PMNode {
  const info = [b("Datum: "), formatDateDe(o.date) || "–"];
  if (o.lecturer) info.push("   ", b("Dozent/in: "), o.lecturer);
  if (o.course) info.push("   ", b("Veranstaltung: "), o.course);
  return doc(
    h(1, o.title),
    p(...info),
    h(2, "Gliederung"),
    ol("…"),
    h(2, "Mitschrift"),
    empty(),
    h(2, "Offene Fragen"),
    tasks("…"),
    h(2, "Zum Wiederholen"),
    ul("…"),
  );
}

// ---- Sortierung im Baum und in Listen ----

export type SortMode = "auto" | "manual" | "name" | "updated";

export const SORT_LABEL: Record<SortMode, string> = {
  auto: "Automatisch: Ordner, dann nach Art – Vorlesungen nach Datum",
  manual: "Eigene Reihenfolge (Ziehen)",
  name: "Name (A–Z)",
  updated: "Zuletzt bearbeitet",
};

const TYPE_ORDER = new Map(NOTE_TYPES.map((t, i) => [t.id, i]));
const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

function lectureKey(n: StudyNode): [string, number] {
  const d = typeof n.meta?.date === "string" ? n.meta.date : "";
  const nr = Number(n.meta?.number);
  return [d, Number.isFinite(nr) ? nr : Number.MAX_SAFE_INTEGER];
}

export function compareNodes(mode: SortMode): (a: StudyNode, b: StudyNode) => number {
  const manual = (a: StudyNode, b: StudyNode) => a.position - b.position || a.created_at.localeCompare(b.created_at);
  if (mode === "manual") return manual;
  if (mode === "name") return (a, b) => collator.compare(a.title, b.title) || manual(a, b);
  if (mode === "updated") return (a, b) => b.updated_at.localeCompare(a.updated_at) || manual(a, b);
  return (a, b) => {
    const ta = noteTypeOf(a);
    const tb = noteTypeOf(b);
    // Struktur (Semester, Veranstaltung, Ordner …) zuerst, in eigener Reihenfolge
    if (!ta || !tb) return ta === tb ? manual(a, b) : ta ? 1 : -1;
    if (ta !== tb) return TYPE_ORDER.get(ta)! - TYPE_ORDER.get(tb)!;
    if (ta === "vorlesung") {
      const [da, na] = lectureKey(a);
      const [db, nb] = lectureKey(b);
      if (da && db && da !== db) return da.localeCompare(db);
      if (na !== nb) return na - nb;
    }
    return manual(a, b);
  };
}
