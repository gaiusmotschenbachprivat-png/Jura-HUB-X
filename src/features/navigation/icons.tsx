import {
  BookMarked,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CircleCheck,
  FileText,
  Folder,
  Gavel,
  Hash,
  Highlighter,
  Layers,
  Library,
  ListTree,
  NotebookPen,
  PencilLine,
  Presentation,
  Quote,
  Scale,
  SquareStack,
  Target,
  type LucideIcon,
} from "lucide-react";

import type { NodeKind, StudyNode } from "../../api/types";
import { noteTypeInfo, noteTypeOf, type NoteType } from "../../lib/noteTypes";

export const KIND_ICON: Record<NodeKind, LucideIcon> = {
  semester: CalendarRange,
  module: Layers,
  course: BookOpen,
  session: CalendarDays,
  topic: Hash,
  folder: Folder,
  note: FileText,
};

/** Symbole für alle Inhaltsarten (Struktur, Wissensobjekte, Lernen, Planung). */
export const ANY_ICON: Record<string, LucideIcon> = {
  ...KIND_ICON,
  definition: Quote,
  schema: ListTree,
  case: Gavel,
  citation: Scale,
  quelle: Library,
  card: SquareStack,
  task: CircleCheck,
  aufgabe: CircleCheck,
  frage: CircleCheck,
  lernziel: CircleCheck,
  exam: CalendarClock,
  annotation: Highlighter,
  document: FileText,
};

export function KindIcon({ kind, size = 15 }: { kind: string; size?: number }) {
  const I = ANY_ICON[kind] ?? FileText;
  return <I size={size} strokeWidth={1.75} aria-hidden />;
}

export const NOTE_TYPE_ICON: Record<NoteType, LucideIcon> = {
  vorlesung: Presentation,
  zusammenfassung: BookMarked,
  fall: Gavel,
  uebung: PencilLine,
  hausarbeit: NotebookPen,
  klausur: Target,
  notiz: FileText,
};

/** Symbol für eine Notizart, farbig. */
export function NoteTypeIcon({ type, size = 15, plain = false }: { type: NoteType; size?: number; plain?: boolean }) {
  const I = NOTE_TYPE_ICON[type];
  return <I size={size} strokeWidth={1.9} aria-hidden style={plain ? undefined : { color: noteTypeInfo(type).color }} />;
}

/** Symbol für einen Knoten: Notizen nach Art, sonst nach Strukturtyp. */
export function NodeIcon({ node, size = 15 }: { node: Pick<StudyNode, "kind" | "meta">; size?: number }) {
  const t = noteTypeOf(node);
  return t ? <NoteTypeIcon type={t} size={size} /> : <KindIcon kind={node.kind} size={size} />;
}
