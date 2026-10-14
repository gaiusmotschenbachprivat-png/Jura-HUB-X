/**
 * Lokale Volltextsuche mit SQLite FTS5 (Port von `search.rs`).
 * Der Index wird in derselben Transaktion gepflegt wie die Inhalte.
 */
import type { Db } from "./db";
import { breadcrumb } from "./repo/nodes";
import { placementSummary } from "./repo/documents";
import * as nodes from "./repo/nodes";
import * as knowledge from "./repo/knowledge";
import * as cards from "./repo/cards";
import * as planning from "./repo/planning";
import * as annotations from "./repo/annotations";

export const HL_START = "\u0002";
export const HL_END = "\u0003";

export type Entity = "node" | "note" | "document" | "page" | "knowledge" | "card" | "task" | "exam" | "annotation";

export function remove(db: Db, entity: Entity, id: string): void {
  db.run("DELETE FROM search_index WHERE entity_type = ?1 AND entity_id = ?2", [entity, id]);
}

export function put(
  db: Db,
  entity: Entity,
  id: string,
  areaId: string | null,
  page: number | null,
  title: string,
  body: string,
): void {
  if (entity === "page") {
    db.run("DELETE FROM search_index WHERE entity_type = 'page' AND entity_id = ?1 AND page = ?2", [id, page]);
  } else {
    remove(db, entity, id);
  }
  db.run(
    `INSERT INTO search_index (entity_type, entity_id, area_id, page, title, body)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    [entity, id, areaId, page, title, body],
  );
}

const SPLIT = /[\s"'()*:^{}[\]\-+,;.§!?/\\<>=&|]/u;

/**
 * Wandelt eine Benutzereingabe in eine sichere FTS5-Abfrage um.
 * Jedes Wort wird als Präfix gesucht, alle Wörter müssen vorkommen.
 */
export function buildQuery(input: string): string | null {
  const terms = input
    .split(SPLIT)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((t) => `"${t.replace(/"/g, "")}"*`);
  return terms.length ? terms.join(" ") : null;
}

export interface SearchHit {
  entity_type: string;
  entity_id: string;
  area_id: string | null;
  page: number | null;
  title: string;
  snippet: string;
  path: string;
  kind: string | null;
  target_id: string | null;
}

const SEARCH_SQL = `SELECT s.entity_type, s.entity_id, s.area_id, s.page,
        highlight(search_index, 4, ?3, ?4) AS title,
        snippet(search_index, 5, ?3, ?4, '…', 14) AS snippet
 FROM search_index s
 WHERE search_index MATCH ?1
   AND (
     (s.entity_type IN ('node','note') AND EXISTS (
        SELECT 1 FROM nodes n WHERE n.id = s.entity_id AND n.deleted_at IS NULL))
     OR
     (s.entity_type IN ('document','page') AND EXISTS (
        SELECT 1 FROM documents d WHERE d.id = s.entity_id AND d.deleted_at IS NULL))
     OR (s.entity_type = 'knowledge' AND EXISTS (SELECT 1 FROM knowledge k WHERE k.id = s.entity_id AND k.deleted_at IS NULL))
     OR (s.entity_type = 'card' AND EXISTS (SELECT 1 FROM flashcards c WHERE c.id = s.entity_id AND c.deleted_at IS NULL))
     OR (s.entity_type = 'task' AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = s.entity_id AND t.deleted_at IS NULL))
     OR (s.entity_type = 'exam' AND EXISTS (SELECT 1 FROM exams e WHERE e.id = s.entity_id AND e.deleted_at IS NULL))
     OR (s.entity_type = 'annotation' AND EXISTS (
        SELECT 1 FROM annotations a JOIN documents d ON d.id = a.document_id
        WHERE a.id = s.entity_id AND d.deleted_at IS NULL))
   )
   AND (
     ?2 IS NULL
     OR s.area_id = ?2
     OR (s.entity_type IN ('knowledge','card','task','exam') AND s.area_id IS NULL)
     OR EXISTS (SELECT 1 FROM node_area_refs r WHERE r.node_id = s.entity_id AND r.area_id = ?2)
     OR (s.entity_type IN ('document','page','annotation') AND (
          EXISTS (
            SELECT 1 FROM placements p JOIN nodes n ON n.id = p.node_id
            WHERE p.document_id = (CASE WHEN s.entity_type = 'annotation'
                    THEN (SELECT a.document_id FROM annotations a WHERE a.id = s.entity_id) ELSE s.entity_id END)
              AND n.area_id = ?2 AND n.deleted_at IS NULL)
          OR NOT EXISTS (
            SELECT 1 FROM placements p JOIN nodes n ON n.id = p.node_id
            WHERE p.document_id = (CASE WHEN s.entity_type = 'annotation'
                    THEN (SELECT a.document_id FROM annotations a WHERE a.id = s.entity_id) ELSE s.entity_id END)
              AND n.deleted_at IS NULL)))
   )
 ORDER BY bm25(search_index, 0.0, 0.0, 0.0, 0.0, 8.0, 1.0)
 LIMIT ?5`;

export function search(db: Db, input: string, areaId: string | null, limit: number): SearchHit[] {
  const q = buildQuery(input);
  if (!q) return [];
  const lim = Math.min(200, Math.max(1, Math.trunc(limit)));
  const rows = db.all<{
    entity_type: string;
    entity_id: string;
    area_id: string | null;
    page: number | null;
    title: string;
    snippet: string;
  }>(SEARCH_SQL, [q, areaId, HL_START, HL_END, lim]);
  return rows.map((r) => {
    const h: SearchHit = { ...r, page: r.page === null ? null : Number(r.page), path: "", kind: null, target_id: null };
    switch (h.entity_type) {
      case "node":
      case "note":
        h.path = breadcrumb(db, h.entity_id, false);
        h.kind = (db.value<string>("SELECT kind FROM nodes WHERE id = ?1", [h.entity_id]) as string | undefined) ?? null;
        break;
      case "knowledge": {
        h.kind = (db.value<string>("SELECT type FROM knowledge WHERE id = ?1", [h.entity_id]) as string | undefined) ?? null;
        const node = db.value<string | null>("SELECT node_id FROM knowledge WHERE id = ?1", [h.entity_id]);
        h.path = node ? breadcrumb(db, node, true) : "";
        break;
      }
      case "card":
      case "task":
      case "exam":
        h.kind = h.entity_type;
        break;
      case "annotation": {
        const doc = db.get<{ id: string; title: string }>(
          "SELECT d.id, d.title FROM annotations a JOIN documents d ON d.id = a.document_id WHERE a.id = ?1",
          [h.entity_id],
        );
        if (doc) {
          h.path = `Markierung in „${doc.title}“`;
          h.target_id = doc.id;
        }
        break;
      }
      default:
        h.path = placementSummary(db, h.entity_id);
    }
    return h;
  });
}

/** Baut den gesamten Index aus den Daten neu auf (z. B. nach einer Wiederherstellung). */
export function rebuild(db: Db): void {
  db.tx(() => {
    db.run("DELETE FROM search_index");
    nodes.reindexAll(db);
    db.run(
      `INSERT INTO search_index (entity_type, entity_id, area_id, page, title, body)
       SELECT 'document', d.id, NULL, NULL, d.title, d.original_name FROM documents d`,
    );
    db.run(
      `INSERT INTO search_index (entity_type, entity_id, area_id, page, title, body)
       SELECT 'page', p.document_id, NULL, p.page_no, d.title, p.text
       FROM document_pages p JOIN documents d ON d.id = p.document_id`,
    );
    knowledge.reindexAll(db);
    cards.reindexAll(db);
    planning.reindexAll(db);
    annotations.reindexAll(db);
  });
}
