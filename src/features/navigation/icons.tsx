import {
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
  ListTree,
  Quote,
  Scale,
  SquareStack,
  type LucideIcon,
} from "lucide-react";

import type { NodeKind } from "../../api/types";

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
