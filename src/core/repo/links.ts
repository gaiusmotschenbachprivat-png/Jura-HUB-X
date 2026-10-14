/**
 * Interne Verknüpfungen zwischen Inhalten – Port von `repo/links.rs`.
 * Jede Verknüpfung ist in beide Richtungen abfragbar (Rückverweise).
 */
import type { EntityType, LinkView } from "../../api/types";
import type { Db } from "../db";
import { CoreError } from "../errors";
import { isPlainObject, newId, now, requireId } from "../util";
import * as documents from "./documents";
import { get as knowledgeGet } from "./knowledge";
import * as nodes from "./nodes";

export const ENTITY_TYPES = ["node", "document", "knowledge"];
export const LINK_KINDS = ["related", "page", "mention"];

/** Eingabe wie `NewLink` in Rust (`kind` Standard „related“, `anchor` Standard `{}`). */
export interface NewLinkInput {
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  kind?: string;
  anchor?: unknown;
}

/**
 * JSON-Text wie `serde_json::to_string` für `Value` ohne `preserve_order`:
 * Objektschlüssel sortiert.
 */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(",")}]`;
  if (isPlainObject(v)) {
    const keys = Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

function checkEntity(db: Db, t: string, id: string): void {
  if (!ENTITY_TYPES.includes(t)) throw CoreError.invalid("Unbekannter Inhaltstyp für Verknüpfung.");
  requireId(id);
  if (t === "node") nodes.get(db, id);
  else if (t === "knowledge") knowledgeGet(db, id);
  else documents.get(db, null, id);
}

export function add(db: Db, l: NewLinkInput): string {
  const kind = l.kind ?? "related";
  if (!LINK_KINDS.includes(kind)) throw CoreError.invalid("Unbekannte Art von Verknüpfung.");
  checkEntity(db, l.source_type, l.source_id);
  checkEntity(db, l.target_type, l.target_id);
  if (l.source_type === l.target_type && l.source_id === l.target_id) {
    throw CoreError.invalid("Ein Inhalt kann nicht mit sich selbst verknüpft werden.");
  }
  const anchor = l.anchor ?? {};
  if (isPlainObject(anchor) && "page" in anchor) {
    const p = anchor.page;
    if (!(typeof p === "number" && Number.isSafeInteger(p) && p >= 1)) throw CoreError.invalid("Ungültige Seitenzahl.");
  }
  const anchorS = canonicalJson(anchor);
  // Doppelte Verknüpfungen vermeiden
  const existing = db.value<string>(
    "SELECT id FROM links WHERE source_type=?1 AND source_id=?2 AND target_type=?3 AND target_id=?4 AND anchor=?5",
    [l.source_type, l.source_id, l.target_type, l.target_id, anchorS],
  );
  if (existing !== undefined) return existing;
  const id = newId();
  db.run(
    `INSERT INTO links (id, source_type, source_id, target_type, target_id, kind, anchor, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    [id, l.source_type, l.source_id, l.target_type, l.target_id, kind, anchorS, now()],
  );
  return id;
}

export function remove(db: Db, id: string): void {
  requireId(id);
  db.run("DELETE FROM links WHERE id = ?1", [id]);
}

type Described = { title: string; kind: string | null; path: string; missing: boolean };
const GONE: Described = { title: "(gelöscht)", kind: null, path: "", missing: true };

function describe(db: Db, t: string, id: string): Described {
  if (t === "node") {
    const r = db.get<{ title: string; kind: string; deleted_at: string | null }>(
      "SELECT title, kind, deleted_at FROM nodes WHERE id = ?1",
      [id],
    );
    if (!r) return { ...GONE };
    return { title: r.title, kind: r.kind, path: nodes.breadcrumb(db, id, false), missing: r.deleted_at !== null };
  }
  if (t === "knowledge") {
    const r = db.get<{ title: string; type: string; node_id: string | null; deleted_at: string | null }>(
      "SELECT title, type, node_id, deleted_at FROM knowledge WHERE id = ?1",
      [id],
    );
    if (!r) return { ...GONE };
    const path = r.node_id !== null ? nodes.breadcrumb(db, r.node_id, true) : "";
    return { title: r.title, kind: r.type, path, missing: r.deleted_at !== null };
  }
  const r = db.get<{ title: string; deleted_at: string | null }>("SELECT title, deleted_at FROM documents WHERE id = ?1", [id]);
  if (!r) return { ...GONE };
  return { title: r.title, kind: null, path: documents.placementSummary(db, id), missing: r.deleted_at !== null };
}

function parseAnchor(s: string): LinkView["anchor"] {
  try {
    return JSON.parse(s) as LinkView["anchor"];
  } catch {
    return null;
  }
}

/** Alle Verknüpfungen eines Inhalts, ausgehend und eingehend. */
export function forEntity(db: Db, t: string, id: string): LinkView[] {
  const rows = db.all<{
    id: string;
    kind: string;
    anchor: string;
    direction: "outgoing" | "incoming";
    other_type: string;
    other_id: string;
    created_at: string;
  }>(
    `SELECT id, kind, anchor, 'outgoing' AS direction, target_type AS other_type, target_id AS other_id, created_at FROM links
       WHERE source_type = ?1 AND source_id = ?2
     UNION ALL
     SELECT id, kind, anchor, 'incoming', source_type, source_id, created_at FROM links
       WHERE target_type = ?1 AND target_id = ?2
     ORDER BY 7 DESC`,
    [t, id],
  );
  return rows.map((r) => {
    const d = describe(db, r.other_type, r.other_id);
    return {
      id: r.id,
      kind: r.kind,
      anchor: parseAnchor(r.anchor),
      direction: r.direction,
      other_type: r.other_type as EntityType,
      other_id: r.other_id,
      other_title: d.title,
      other_kind: d.kind,
      other_path: d.path,
      other_missing: d.missing,
      created_at: r.created_at,
    };
  });
}

/** Entfernt alle Verknüpfungen eines endgültig gelöschten Inhalts. */
export function removeForEntity(db: Db, t: string, id: string): void {
  db.run(
    "DELETE FROM links WHERE (source_type = ?1 AND source_id = ?2) OR (target_type = ?1 AND target_id = ?2)",
    [t, id],
  );
}
