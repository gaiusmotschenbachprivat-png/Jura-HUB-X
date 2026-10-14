import {
  BookOpen,
  CalendarDays,
  CalendarRange,
  FileText,
  Folder,
  Hash,
  Layers,
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

export function KindIcon({ kind, size = 15 }: { kind: NodeKind; size?: number }) {
  const I = KIND_ICON[kind];
  return <I size={size} strokeWidth={1.75} aria-hidden />;
}
