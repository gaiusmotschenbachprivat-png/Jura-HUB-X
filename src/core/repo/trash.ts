/** Papierkorb: Löschen ist zuerst immer umkehrbar – Port von `repo/trash.rs`. */
import type { TrashItem, TrashItemType } from "../../api/types";
import type { Ctx } from "../ctx";
import type { Db } from "../db";
import { CoreError } from "../errors";
import * as search from "../search";
import { now, requireId, takeChars } from "../util";
import * as cards from "./cards";
import * as knowledge from "./knowledge";
import * as links from "./links";
import * as nodes from "./nodes";
import * as planning from "./planning";

/** Verschiebt einen Knoten samt Unterknoten in den Papierkorb. */
export function trashNode(db: Db, id: string): void {
  requireId(id);
  db.tx(() => {
    const node = nodes.get(db, id);
    if (node.deleted_at) return;
    const ts = now();
    for (const sid of nodes.subtreeIds(db, id)) {
      db.run("UPDATE nodes SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", [sid, ts]);
    }
  });
}

/** Stellt einen beliebigen Eintrag aus dem Papierkorb wieder her. */
export function restoreAny(db: Db, itemType: string, id: string): void {
  switch (itemType) {
    case "node":
      return restoreNode(db, id);
    case "document":
      return restoreDocument(db, id);
    case "knowledge":
      return knowledge.restore(db, id);
    case "card":
      return cards.restore(db, id);
    case "task":
    case "exam":
      return planning.restore(db, itemType, id);
    default:
      throw CoreError.invalid("Unbekannter Eintrag.");
  }
}

/** Löscht einen Eintrag aus dem Papierkorb endgültig. */
export async function purgeAny(ctx: Ctx, itemType: TrashItemType | string, id: string): Promise<void> {
  switch (itemType) {
    case "node":
      return purgeNode(ctx.db, id);
    case "document":
      return purgeDocument(ctx, id);
    case "knowledge":
      return knowledge.purge(ctx.db, id);
    case "card":
      return cards.purge(ctx.db, id);
    case "task":
    case "exam":
      return planning.purge(ctx.db, itemType, id);
    default:
      throw CoreError.invalid("Unbekannter Eintrag.");
  }
}

/**
 * Holt einen Knoten zurück. Liegt der Elternknoten selbst im Papierkorb,
 * landet der Knoten auf der obersten Ebene seines Studienbereichs.
 */
export function restoreNode(db: Db, id: string): void {
  requireId(id);
  db.tx(() => {
    const node = nodes.get(db, id);
    const ts = node.deleted_at;
    if (!ts) return;
    for (const sid of nodes.subtreeIds(db, id)) {
      db.run("UPDATE nodes SET deleted_at = NULL WHERE id = ?1 AND deleted_at = ?2", [sid, ts]);
    }
    if (node.parent_id !== null) {
      const parent = nodes.get(db, node.parent_id);
      if (parent.deleted_at) db.run("UPDATE nodes SET parent_id = NULL WHERE id = ?1", [id]);
    }
  });
}

export function trashDocument(db: Db, id: string): void {
  requireId(id);
  db.run("UPDATE documents SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", [id, now()]);
}

export function restoreDocument(db: Db, id: string): void {
  requireId(id);
  db.run("UPDATE documents SET deleted_at = NULL WHERE id = ?1", [id]);
}

export function list(db: Db): TrashItem[] {
  const out: TrashItem[] = [];
  // Nur die "obersten" gelöschten Knoten: Elternknoten nicht im selben Löschvorgang.
  const nodeRows = db.all<{ id: string; title: string; kind: string; area_id: string; deleted_at: string; cnt: number }>(
    `SELECT n.id, n.title, n.kind, n.area_id, n.deleted_at,
            (SELECT COUNT(*) FROM nodes c WHERE c.deleted_at = n.deleted_at AND c.id != n.id) AS cnt
     FROM nodes n LEFT JOIN nodes p ON p.id = n.parent_id
     WHERE n.deleted_at IS NOT NULL AND (p.id IS NULL OR p.deleted_at IS NULL OR p.deleted_at != n.deleted_at)
     ORDER BY n.deleted_at DESC`,
  );
  for (const r of nodeRows) {
    out.push({
      item_type: "node",
      id: r.id,
      title: r.title,
      kind: r.kind,
      area_id: r.area_id,
      deleted_at: r.deleted_at,
      children: Number(r.cnt),
      path: nodes.breadcrumb(db, r.id, false),
    });
  }
  const docRows = db.all<{ id: string; title: string; deleted_at: string }>(
    "SELECT id, title, deleted_at FROM documents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
  );
  for (const r of docRows) {
    out.push({
      item_type: "document",
      id: r.id,
      title: r.title,
      kind: null,
      area_id: null,
      deleted_at: r.deleted_at,
      children: 0,
      path: "",
    });
  }
  // Wissensobjekte, Karteikarten, Aufgaben und Prüfungstermine
  const extra: [TrashItemType, string][] = [
    ["knowledge", "SELECT id, title, type AS kind, area_id, deleted_at FROM knowledge WHERE deleted_at IS NOT NULL"],
    ["card", "SELECT id, front AS title, 'card' AS kind, area_id, deleted_at FROM flashcards WHERE deleted_at IS NOT NULL"],
    ["task", "SELECT id, title, kind, area_id, deleted_at FROM tasks WHERE deleted_at IS NOT NULL"],
    ["exam", "SELECT id, title, 'exam' AS kind, area_id, deleted_at FROM exams WHERE deleted_at IS NOT NULL"],
  ];
  for (const [itemType, sql] of extra) {
    for (const r of db.all<{ id: string; title: string; kind: string; area_id: string | null; deleted_at: string }>(sql)) {
      out.push({
        item_type: itemType,
        id: r.id,
        title: takeChars(r.title, 200),
        kind: r.kind,
        area_id: r.area_id,
        deleted_at: r.deleted_at,
        children: 0,
        path: "",
      });
    }
  }
  out.sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : a.deleted_at > b.deleted_at ? -1 : 0));
  return out;
}

/** Löscht einen Knoten (samt Unterknoten) endgültig. Nur für Einträge im Papierkorb. */
export function purgeNode(db: Db, id: string): void {
  requireId(id);
  db.tx(() => {
    const node = nodes.get(db, id);
    if (!node.deleted_at) throw CoreError.invalid("Nur Einträge im Papierkorb können endgültig gelöscht werden.");
    for (const sid of nodes.subtreeIds(db, id)) {
      search.remove(db, "node", sid);
      search.remove(db, "note", sid);
      links.removeForEntity(db, "node", sid);
    }
    db.run("DELETE FROM nodes WHERE id = ?1", [id]);
  });
}

/**
 * Datenbankteil von `purge_document`. Liefert den SHA-256 der Datei, wenn sie
 * nach dem Commit aus dem Speicher entfernt werden soll, sonst `null`.
 */
export function purgeDocumentDb(db: Db, id: string): string | null {
  requireId(id);
  return db.tx(() => {
    const r = db.get<{ blob_sha: string; deleted_at: string | null }>(
      "SELECT blob_sha, deleted_at FROM documents WHERE id = ?1",
      [id],
    );
    // rusqlite: `query_row` ohne Treffer → Error::Db(QueryReturnedNoRows)
    if (!r) throw new CoreError("db", "Datenbankfehler: Query returned no rows");
    if (r.deleted_at === null) throw CoreError.invalid("Nur Dokumente im Papierkorb können endgültig gelöscht werden.");
    const sha = r.blob_sha;
    search.remove(db, "document", id);
    db.run("DELETE FROM search_index WHERE entity_type = 'page' AND entity_id = ?1", [id]);
    links.removeForEntity(db, "document", id);
    db.run("DELETE FROM documents WHERE id = ?1", [id]);
    // Datei bleibt, solange ein anderes Dokument oder ein Bild in einer Notiz sie nutzt.
    const stillUsed = Number(
      db.value(
        `SELECT (SELECT COUNT(*) FROM documents WHERE blob_sha = ?1)
              + (SELECT COUNT(*) FROM notes WHERE instr(content_json, ?1) > 0)
              + (SELECT COUNT(*) FROM note_versions WHERE instr(content_json, ?1) > 0)`,
        [sha],
      ) ?? 0,
    );
    if (stillUsed === 0) db.run("DELETE FROM blobs WHERE sha256 = ?1", [sha]);
    return stillUsed === 0 ? sha : null;
  });
}

/**
 * Löscht ein Dokument endgültig. Die Datei wird nur entfernt, wenn kein
 * anderes Dokument und keine Notiz sie noch verwendet – erst nach dem Commit.
 */
export async function purgeDocument(ctx: Ctx, id: string): Promise<void> {
  const sha = purgeDocumentDb(ctx.db, id);
  if (sha !== null) await ctx.blobs.remove(sha);
}
