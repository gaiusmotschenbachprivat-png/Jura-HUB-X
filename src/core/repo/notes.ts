/** Notizinhalte und Versionshistorie – Port von `repo/notes.rs`. */
import type { Note, RecentNote, SaveResult, VersionMeta } from "../../api/types";
import type { Db } from "../db";
import { CoreError } from "../errors";
import { byteLen, CONTROL, isId, newId, now, parseTs, requireId, takeChars, wordCount } from "../util";
import * as nodes from "./nodes";

export const MAX_CONTENT_BYTES = 20 * 1024 * 1024;
export const VERSION_INTERVAL_SECS = 10 * 60;
export const MAX_VERSIONS = 200;

export function validateContent(content: string): void {
  if (typeof content !== "string") throw CoreError.invalid("Der Notizinhalt ist beschädigt und wurde nicht gespeichert.");
  if (byteLen(content) > MAX_CONTENT_BYTES) throw CoreError.invalid("Die Notiz ist zu groß (über 20 MB).");
  let v: unknown;
  try {
    v = JSON.parse(content);
  } catch {
    throw CoreError.invalid("Der Notizinhalt ist beschädigt und wurde nicht gespeichert.");
  }
  if (!v || typeof v !== "object" || (v as { type?: unknown }).type !== "doc") {
    throw CoreError.invalid("Der Notizinhalt hat ein unbekanntes Format.");
  }
}

export function get(db: Db, nodeId: string): Note {
  requireId(nodeId);
  const r = db.get<Omit<Note, "path">>(
    `SELECT n.id AS node_id, n.title, n.area_id, t.content_json, t.template, t.word_count, t.updated_at
     FROM nodes n JOIN notes t ON t.node_id = n.id WHERE n.id = ?1`,
    [nodeId],
  );
  if (!r) throw CoreError.notFound("Notiz nicht gefunden. Sie wurde eventuell gelöscht.");
  return { ...r, word_count: Number(r.word_count), path: nodes.breadcrumb(db, nodeId, false) };
}

export function save(db: Db, nodeId: string, contentJson: string, plainText: string): SaveResult {
  requireId(nodeId);
  validateContent(contentJson);
  const text = String(plainText ?? "");
  return db.tx(() => {
    const node = nodes.get(db, nodeId);
    if (node.kind !== "note") throw CoreError.invalid("Dieser Eintrag ist keine Notiz.");
    if (node.deleted_at) throw CoreError.invalid("Die Notiz liegt im Papierkorb. Stelle sie zuerst wieder her.");
    const ts = now();
    const changed = db.run(
      `UPDATE notes SET content_json = ?2, plain_text = ?3, word_count = ?4, updated_at = ?5
       WHERE node_id = ?1 AND content_json != ?2`,
      [nodeId, contentJson, text, wordCount(text), ts],
    );
    if (changed === 0) {
      const updatedAt = db.value<string>("SELECT updated_at FROM notes WHERE node_id = ?1", [nodeId]) ?? ts;
      return { updated_at: updatedAt, version_created: false };
    }
    db.run("UPDATE nodes SET updated_at = ?2 WHERE id = ?1", [nodeId, ts]);
    nodes.index(db, node, text);
    syncMentions(db, nodeId, contentJson);
    const last = db.value<string>(
      "SELECT created_at FROM note_versions WHERE node_id = ?1 ORDER BY created_at DESC LIMIT 1",
      [nodeId],
    );
    const due = last === undefined || (parseTs(ts) - parseTs(last)) / 1000 >= VERSION_INTERVAL_SECS;
    if (due) insertVersion(db, nodeId, contentJson, text, "Automatisch");
    return { updated_at: ts, version_created: due };
  });
}

function insertVersion(db: Db, nodeId: string, content: string, text: string, reason: string) {
  db.run(
    `INSERT INTO note_versions (id, node_id, content_json, plain_text, word_count, reason, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    [newId(), nodeId, content, text, wordCount(text), reason, now()],
  );
  db.run(
    `DELETE FROM note_versions WHERE node_id = ?1 AND id NOT IN (
        SELECT id FROM note_versions WHERE node_id = ?1 ORDER BY created_at DESC LIMIT ?2)`,
    [nodeId, MAX_VERSIONS],
  );
}

export function createVersion(db: Db, nodeId: string, reason: string): void {
  requireId(nodeId);
  const r = db.get<{ content_json: string; plain_text: string }>(
    "SELECT content_json, plain_text FROM notes WHERE node_id = ?1",
    [nodeId],
  );
  if (!r) throw CoreError.notFound("Notiz nicht gefunden.");
  const clean = takeChars(String(reason ?? "").replace(CONTROL, ""), 80);
  insertVersion(db, nodeId, r.content_json, r.plain_text, clean.trim() ? clean : "Manuell");
}

export function listVersions(db: Db, nodeId: string): VersionMeta[] {
  return db
    .all<VersionMeta>(
      "SELECT id, reason, created_at, word_count FROM note_versions WHERE node_id = ?1 ORDER BY created_at DESC",
      [nodeId],
    )
    .map((v) => ({ ...v, word_count: Number(v.word_count) }));
}

export function getVersionContent(db: Db, versionId: string): string {
  requireId(versionId);
  const c = db.value<string>("SELECT content_json FROM note_versions WHERE id = ?1", [versionId]);
  if (c === undefined) throw CoreError.notFound("Version nicht gefunden.");
  return c;
}

export function restoreVersion(db: Db, nodeId: string, versionId: string): SaveResult {
  requireId(nodeId);
  requireId(versionId);
  return db.tx(() => {
    const v = db.get<{ node_id: string; content_json: string; plain_text: string }>(
      "SELECT node_id, content_json, plain_text FROM note_versions WHERE id = ?1",
      [versionId],
    );
    if (!v) throw CoreError.notFound("Version nicht gefunden.");
    if (v.node_id !== nodeId) throw CoreError.invalid("Diese Version gehört zu einer anderen Notiz.");
    const cur = db.get<{ content_json: string; plain_text: string }>(
      "SELECT content_json, plain_text FROM notes WHERE node_id = ?1",
      [nodeId],
    );
    if (!cur) throw CoreError.notFound("Notiz nicht gefunden.");
    insertVersion(db, nodeId, cur.content_json, cur.plain_text, "Vor Wiederherstellung");
    const ts = now();
    db.run(
      "UPDATE notes SET content_json = ?2, plain_text = ?3, word_count = ?4, updated_at = ?5 WHERE node_id = ?1",
      [nodeId, v.content_json, v.plain_text, wordCount(v.plain_text), ts],
    );
    db.run("UPDATE nodes SET updated_at = ?2 WHERE id = ?1", [nodeId, ts]);
    const node = nodes.get(db, nodeId);
    nodes.index(db, node, v.plain_text);
    syncMentions(db, nodeId, v.content_json);
    return { updated_at: ts, version_created: true };
  });
}

export function recent(db: Db, areaId: string | null, limit: number): RecentNote[] {
  const lim = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 1)));
  return db
    .all<Omit<RecentNote, "path">>(
      `SELECT n.id AS node_id, n.title, n.area_id, t.updated_at, t.word_count
       FROM nodes n JOIN notes t ON t.node_id = n.id
       WHERE n.deleted_at IS NULL AND (?1 IS NULL OR n.area_id = ?1)
       ORDER BY t.updated_at DESC LIMIT ?2`,
      [areaId, lim],
    )
    .map((n) => ({ ...n, word_count: Number(n.word_count), path: nodes.breadcrumb(db, n.node_id, false) }));
}

export interface Mention {
  target_type: string;
  target_id: string;
  page: number | null;
}

export function parseInternalHref(href: string): Mention | null {
  if (!href.startsWith("studium:")) return null;
  const rest = href.slice("studium:".length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const kind = rest.slice(0, slash);
  const after = rest.slice(slash + 1);
  const hash = after.indexOf("#");
  const id = hash < 0 ? after : after.slice(0, hash);
  const frag = hash < 0 ? null : after.slice(hash + 1);
  if (!isId(id) || !["node", "document", "knowledge"].includes(kind)) return null;
  let page: number | null = null;
  if (frag?.startsWith("page=")) {
    const p = frag.slice(5);
    if (/^[+-]?\d+$/.test(p) && Number(p) >= 1) page = Number(p);
  }
  return { target_type: kind, target_id: id, page };
}

/** Sammelt alle internen Links aus einem ProseMirror-Dokument (sortiert, ohne Dubletten). */
export function extractMentions(contentJson: string): Mention[] {
  const out: Mention[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    const o = v as { marks?: unknown; content?: unknown };
    if (Array.isArray(o.marks)) {
      for (const m of o.marks as { type?: unknown; attrs?: { href?: unknown } }[]) {
        if (m?.type === "link" && typeof m.attrs?.href === "string") {
          const x = parseInternalHref(m.attrs.href);
          if (x) out.push(x);
        }
      }
    }
    if (Array.isArray(o.content)) o.content.forEach(walk);
  };
  try {
    walk(JSON.parse(contentJson));
  } catch {
    return [];
  }
  const key = (m: Mention) => `${m.target_type}\u0000${m.target_id}\u0000${m.page ?? -1}`;
  const seen = new Map<string, Mention>();
  for (const m of out) seen.set(key(m), m);
  return [...seen.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

function syncMentions(db: Db, nodeId: string, contentJson: string) {
  db.run("DELETE FROM links WHERE source_type = 'node' AND source_id = ?1 AND kind = 'mention'", [nodeId]);
  for (const m of extractMentions(contentJson)) {
    if (m.target_type === "node" && m.target_id === nodeId) continue;
    const table = m.target_type === "node" ? "nodes" : m.target_type === "knowledge" ? "knowledge" : "documents";
    if (db.value(`SELECT 1 FROM ${table} WHERE id = ?1`, [m.target_id]) === undefined) continue;
    const anchor = m.page !== null ? JSON.stringify({ page: m.page }) : "{}";
    db.run(
      `INSERT INTO links (id, source_type, source_id, target_type, target_id, kind, anchor, created_at)
       VALUES (?1, 'node', ?2, ?3, ?4, 'mention', ?5, ?6)`,
      [newId(), nodeId, m.target_type, m.target_id, anchor, now()],
    );
  }
}
