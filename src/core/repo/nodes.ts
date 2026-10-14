/**
 * Flexibler Strukturbaum – Port von `repo/nodes.rs`.
 */
import type { NewNode, StudyNode } from "../../api/types";
import type { Db } from "../db";
import { CoreError } from "../errors";
import * as search from "../search";
import { byteLen, cleanTitle, isPlainObject, newId, now, parseJson, requireId, wordCount } from "../util";
import * as areas from "./areas";
import { validateContent } from "./notes";

export const KINDS = ["semester", "module", "course", "session", "topic", "folder", "note"];
export const EMPTY_DOC = '{"type":"doc","content":[{"type":"paragraph"}]}';
const MAX_META = 64 * 1024;

type NodeRow = Omit<StudyNode, "meta"> & { meta: string };

export function fromRow(r: NodeRow): StudyNode {
  const meta = parseJson<unknown>(r.meta, {});
  return {
    id: r.id,
    area_id: r.area_id,
    parent_id: r.parent_id,
    kind: r.kind,
    title: r.title,
    position: Number(r.position),
    meta: isPlainObject(meta) ? meta : {},
    created_at: r.created_at,
    updated_at: r.updated_at,
    archived_at: r.archived_at,
    deleted_at: r.deleted_at,
  };
}

const COLS = "id, area_id, parent_id, kind, title, position, meta, created_at, updated_at, archived_at, deleted_at";

/** Text aus den Metadaten (Dozent, Ort, Beschreibung …) für die Suche. */
export function metaText(meta: Record<string, unknown>): string {
  const out: string[] = [];
  for (const v of Object.values(meta)) {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === "string"));
  }
  return out.join(" ");
}

function cleanMeta(meta: unknown): string {
  const m = meta ?? {};
  if (!isPlainObject(m)) throw CoreError.invalid("Zusatzangaben müssen ein Objekt sein.");
  const s = JSON.stringify(m);
  if (byteLen(s) > MAX_META) throw CoreError.invalid("Die Zusatzangaben sind zu umfangreich.");
  return s;
}

export function get(db: Db, id: string): StudyNode {
  const r = db.get<NodeRow>(`SELECT ${COLS} FROM nodes WHERE id = ?1`, [id]);
  if (!r) throw CoreError.notFound("Eintrag nicht gefunden. Er wurde eventuell gelöscht.");
  return fromRow(r);
}

export function list(db: Db, areaId: string | null): StudyNode[] {
  return db
    .all<NodeRow>(
      `SELECT ${COLS} FROM nodes WHERE deleted_at IS NULL AND (?1 IS NULL OR area_id = ?1)
       ORDER BY position, created_at`,
      [areaId],
    )
    .map(fromRow);
}

function nextPosition(db: Db, parentId: string | null, areaId: string): number {
  return Number(
    db.value(
      `SELECT COALESCE(MAX(position), 0) + 1024 FROM nodes
       WHERE area_id = ?2 AND ((?1 IS NULL AND parent_id IS NULL) OR parent_id = ?1)`,
      [parentId, areaId],
    ) ?? 1024,
  );
}

export function index(db: Db, n: StudyNode, noteText: string | null): void {
  if (n.kind === "note") search.put(db, "note", n.id, n.area_id, null, n.title, noteText ?? "");
  else search.put(db, "node", n.id, n.area_id, null, n.title, metaText(n.meta));
}

export function create(db: Db, input: NewNode): StudyNode {
  requireId(input.area_id);
  if (!KINDS.includes(input.kind)) throw CoreError.invalid("Unbekannte Art von Eintrag.");
  const title = cleanTitle(input.title, 300);
  const meta = cleanMeta(input.meta);
  const parentId = input.parent_id ?? null;
  return db.tx(() => {
    areas.get(db, input.area_id);
    if (parentId !== null) {
      const parent = get(db, parentId);
      if (parent.area_id !== input.area_id) {
        throw CoreError.invalid("Der übergeordnete Eintrag gehört zu einem anderen Studienbereich.");
      }
      if (parent.deleted_at) throw CoreError.invalid("Der übergeordnete Eintrag liegt im Papierkorb.");
    }
    const id = newId();
    const ts = now();
    const pos = nextPosition(db, parentId, input.area_id);
    db.run(
      `INSERT INTO nodes (id, area_id, parent_id, kind, title, position, meta, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
      [id, input.area_id, parentId, input.kind, title, pos, meta, ts],
    );
    let text = "";
    if (input.kind === "note") {
      const content = input.content_json ?? EMPTY_DOC;
      validateContent(content);
      text = input.plain_text ?? "";
      db.run(
        `INSERT INTO notes (node_id, content_json, plain_text, template, word_count, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        [id, content, text, input.template ?? null, wordCount(text), ts],
      );
    }
    const node = get(db, id);
    index(db, node, text);
    return node;
  });
}

export interface NodePatch {
  title?: string | null;
  meta?: Record<string, unknown> | null;
}

export function update(db: Db, id: string, patch: NodePatch): StudyNode {
  requireId(id);
  return db.tx(() => {
    const node = get(db, id);
    if (patch.title != null) node.title = cleanTitle(patch.title, 300);
    if (patch.meta != null) node.meta = JSON.parse(cleanMeta(patch.meta)) as StudyNode["meta"];
    const ts = now();
    db.run("UPDATE nodes SET title = ?2, meta = ?3, updated_at = ?4 WHERE id = ?1", [id, node.title, JSON.stringify(node.meta), ts]);
    node.updated_at = ts;
    const text = db.value<string>("SELECT plain_text FROM notes WHERE node_id = ?1", [id]);
    index(db, node, text ?? null);
    return node;
  });
}

/** IDs eines Knotens und aller Nachfahren (auch gelöschter). */
export function subtreeIds(db: Db, id: string): string[] {
  return db
    .all<{ id: string }>(
      `WITH RECURSIVE t(id) AS (
          SELECT ?1
          UNION ALL
          SELECT n.id FROM nodes n JOIN t ON n.parent_id = t.id
       ) SELECT id FROM t`,
      [id],
    )
    .map((r) => r.id);
}

export function moveNode(db: Db, id: string, newParent: string | null, position: number, areaId: string | null): StudyNode {
  requireId(id);
  if (typeof position !== "number" || !Number.isFinite(position)) throw CoreError.invalid("Ungültige Position.");
  return db.tx(() => {
    const node = get(db, id);
    let targetArea: string;
    if (newParent !== null) {
      const parent = get(db, newParent);
      if (subtreeIds(db, id).includes(newParent)) {
        throw CoreError.invalid("Ein Eintrag kann nicht in sich selbst verschoben werden.");
      }
      targetArea = parent.area_id;
    } else {
      targetArea = areaId ?? node.area_id;
    }
    areas.get(db, targetArea);
    db.run("UPDATE nodes SET parent_id = ?2, position = ?3, updated_at = ?4 WHERE id = ?1", [id, newParent, position, now()]);
    if (targetArea !== node.area_id) {
      for (const sid of subtreeIds(db, id)) {
        db.run("UPDATE nodes SET area_id = ?2 WHERE id = ?1", [sid, targetArea]);
        db.run("UPDATE search_index SET area_id = ?2 WHERE entity_id = ?1 AND entity_type IN ('node','note')", [sid, targetArea]);
        db.run("DELETE FROM node_area_refs WHERE node_id = ?1 AND area_id = ?2", [sid, targetArea]);
      }
    }
    return get(db, id);
  });
}

export function setArchived(db: Db, id: string, archived: boolean): StudyNode {
  requireId(id);
  const n = db.run("UPDATE nodes SET archived_at = ?2 WHERE id = ?1", [id, archived ? now() : null]);
  if (n === 0) throw CoreError.notFound("Eintrag nicht gefunden.");
  return get(db, id);
}

/** Pfad eines Knotens als Text, z. B. „WS 2026/27 › BGB AT › Termin 3“. */
export function breadcrumb(db: Db, id: string, includeSelf: boolean): string {
  const rows = db.all<{ title: string; depth: number }>(
    `WITH RECURSIVE up(id, parent_id, title, depth) AS (
        SELECT id, parent_id, title, 0 FROM nodes WHERE id = ?1
        UNION ALL
        SELECT n.id, n.parent_id, n.title, up.depth + 1 FROM nodes n JOIN up ON n.id = up.parent_id
        WHERE up.depth < 64
     ) SELECT title, depth FROM up ORDER BY depth DESC`,
    [id],
  );
  return rows
    .filter((r) => Number(r.depth) > 0 || includeSelf)
    .map((r) => r.title)
    .join(" › ");
}

export function addAreaRef(db: Db, nodeId: string, areaId: string): void {
  requireId(nodeId);
  requireId(areaId);
  const node = get(db, nodeId);
  areas.get(db, areaId);
  if (node.area_id === areaId) throw CoreError.invalid("Der Eintrag gehört bereits zu diesem Studienbereich.");
  db.run("INSERT OR IGNORE INTO node_area_refs (node_id, area_id) VALUES (?1, ?2)", [nodeId, areaId]);
}

export function removeAreaRef(db: Db, nodeId: string, areaId: string): void {
  db.run("DELETE FROM node_area_refs WHERE node_id = ?1 AND area_id = ?2", [nodeId, areaId]);
}

export function listAreaRefs(db: Db, areaId: string): StudyNode[] {
  return db
    .all<NodeRow>(
      `SELECT n.* FROM nodes n JOIN node_area_refs r ON r.node_id = n.id
       WHERE r.area_id = ?1 AND n.deleted_at IS NULL ORDER BY n.title`,
      [areaId],
    )
    .map(fromRow);
}

export function areaRefsOf(db: Db, nodeId: string): string[] {
  return db.all<{ area_id: string }>("SELECT area_id FROM node_area_refs WHERE node_id = ?1", [nodeId]).map((r) => r.area_id);
}

export function reindexAll(db: Db): void {
  const rows = db.all<NodeRow & { note_text: string | null }>(
    "SELECT n.*, t.plain_text AS note_text FROM nodes n LEFT JOIN notes t ON t.node_id = n.id",
  );
  for (const r of rows) index(db, fromRow(r), r.note_text);
}
