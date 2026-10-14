import type { StudyNode } from "../api/types";

export interface TreeItem {
  node: StudyNode;
  children: TreeItem[];
  depth: number;
}

/** Baut aus der flachen Liste den Baum. Knoten mit fehlendem Elternknoten landen oben. */
export function buildTree(nodes: StudyNode[], opts: { showArchived?: boolean } = {}): TreeItem[] {
  const byParent = new Map<string | null, StudyNode[]>();
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const key = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
    const list = byParent.get(key) ?? [];
    list.push(n);
    byParent.set(key, list);
  }
  const make = (parent: string | null, depth: number): TreeItem[] =>
    (byParent.get(parent) ?? [])
      .filter((n) => opts.showArchived || !n.archived_at)
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
      .map((node) => ({ node, depth, children: make(node.id, depth + 1) }));
  return make(null, 0);
}

/** Position zwischen zwei Geschwistern (für Drag-and-drop). */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1024;
  if (before === undefined) return (after as number) - 1024;
  if (after === undefined) return before + 1024;
  return (before + after) / 2;
}

/** IDs aller Vorfahren eines Knotens (zum Aufklappen im Baum). */
export function ancestors(nodes: StudyNode[], id: string): string[] {
  const map = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  let cur = map.get(id);
  let guard = 0;
  while (cur?.parent_id && guard++ < 100) {
    out.push(cur.parent_id);
    cur = map.get(cur.parent_id);
  }
  return out;
}

export function isDescendant(nodes: StudyNode[], candidate: string, of: string): boolean {
  return candidate === of || ancestors(nodes, candidate).includes(of);
}
