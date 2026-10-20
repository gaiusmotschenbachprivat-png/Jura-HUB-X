/**
 * Lernstand je Fach (Veranstaltung/Modul) – aus den Karteikarten berechnet,
 * ohne zusätzliche Daten. „Sitzt“ heißt: Karte in der Wiederholungsphase mit
 * einer Stabilität von mindestens 21 Tagen (FSRS), d. h. sie wird voraussichtlich
 * auch in drei Wochen noch gewusst.
 */
import type { Card, CardKind, StudyNode } from "../api/types";

export const MASTERED_STABILITY = 21;

/** Knoten selbst und alles darunter. */
export function descendantIds(nodes: StudyNode[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (n.parent_id && out.has(n.parent_id) && !out.has(n.id)) (out.add(n.id), (grew = true));
  }
  return out;
}

/** Nächstgelegene Veranstaltung bzw. Modul (der Knoten selbst zählt mit). */
export function courseOf(nodes: StudyNode[], id: string | null): StudyNode | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur = id ? byId.get(id) : undefined;
  let module: StudyNode | null = null;
  for (let guard = 0; cur && guard < 100; guard++) {
    if (cur.kind === "course") return cur;
    if (cur.kind === "module" && !module) module = cur;
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return module;
}

export interface FachStats {
  /** null = keinem Fach zugeordnet */
  nodeId: string | null;
  title: string;
  total: number;
  due: number;
  fresh: number;
  learning: number;
  mastered: number;
  difficult: number;
  byKind: Record<CardKind, number>;
}

export const isMastered = (c: Card) => c.state === 2 && c.stability >= MASTERED_STABILITY;

export function statsByFach(cards: Card[], nodes: StudyNode[], nowIso = new Date().toISOString()): FachStats[] {
  const map = new Map<string, FachStats>();
  for (const c of cards) {
    if (c.deleted_at || c.suspended) continue;
    const course = courseOf(nodes, c.node_id);
    const key = course?.id ?? "";
    let s = map.get(key);
    if (!s) {
      s = { nodeId: course?.id ?? null, title: course?.title ?? "Ohne Fach", total: 0, due: 0, fresh: 0, learning: 0, mastered: 0, difficult: 0, byKind: { frage: 0, definition: 0, norm: 0 } };
      map.set(key, s);
    }
    s.total++;
    s.byKind[c.kind] = (s.byKind[c.kind] ?? 0) + 1;
    if (c.due <= nowIso) s.due++;
    if (c.state === 0) s.fresh++;
    else if (isMastered(c)) s.mastered++;
    else s.learning++;
    if (c.difficult) s.difficult++;
  }
  return [...map.values()].sort((a, b) => (a.nodeId === null ? 1 : b.nodeId === null ? -1 : b.due - a.due || a.title.localeCompare(b.title, "de")));
}
