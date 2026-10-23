/**
 * Verlauf des KI-Assistenten – TypeScript-Gegenstück zu `repo/ai_chats.rs`.
 * Gleiche SQL-Texte, gleiche Prüfungen, gleiche Meldungen.
 */
import type { AiChat, AiChatInput, AiChatMeta, AiTask } from "../../api/types";
import type { Db } from "../db";
import { CoreError } from "../errors";
import { byteLen, CONTROL, newId, now, requireId, takeChars } from "../util";

export const TASKS: AiTask[] = ["recherche", "vertrag", "schriftsatz"];
/** Obergrenze je Feld (Verlauf mit Quellen und Denkblöcken kann groß werden) */
export const MAX_CHAT_BYTES = 20 * 1024 * 1024;

const META_COLS = "id, title, task, own_docs, created_at, updated_at";

type Row = Omit<AiChatMeta, "own_docs"> & { own_docs: number | bigint };
const meta = (r: Row): AiChatMeta => ({ ...r, own_docs: Number(r.own_docs) === 1 });

export function cleanChatTitle(s: string): string {
  const t = String(s ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return takeChars(t || "Unterhaltung", 200);
}

function checkJson(s: unknown, what: string): string {
  if (typeof s !== "string") throw CoreError.invalid(`${what}: ungültiger Inhalt.`);
  if (byteLen(s) > MAX_CHAT_BYTES) throw CoreError.invalid("Die Unterhaltung ist zu lang zum Speichern. Beginne eine neue Unterhaltung.");
  try {
    JSON.parse(s);
  } catch {
    throw CoreError.invalid(`${what}: ungültiger Inhalt.`);
  }
  return s;
}

export function list(db: Db): AiChatMeta[] {
  return db.all<Row>(`SELECT ${META_COLS} FROM ai_chats ORDER BY updated_at DESC, id DESC`).map(meta);
}

export function get(db: Db, id: string): AiChat {
  requireId(id);
  const r = db.get<Row & { entries: string; state: string }>(`SELECT ${META_COLS}, entries, state FROM ai_chats WHERE id = ?1`, [id]);
  if (!r) throw CoreError.notFound("Unterhaltung nicht gefunden.");
  return { ...meta(r), entries: r.entries, state: r.state };
}

/** Legt eine Unterhaltung an (id = null) oder überschreibt sie. */
export function save(db: Db, input: AiChatInput): AiChatMeta {
  if (!TASKS.includes(input.task)) throw CoreError.invalid("Unbekannte Aufgabe.");
  const title = cleanChatTitle(input.title);
  const entries = checkJson(input.entries, "Verlauf");
  const state = checkJson(input.state, "Verlauf");
  const ts = now();
  const own = input.own_docs ? 1 : 0;
  if (input.id === null || input.id === undefined) {
    const id = newId();
    db.run(`INSERT INTO ai_chats (id, title, task, own_docs, entries, state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`, [id, title, input.task, own, entries, state, ts]);
    return meta(db.get<Row>(`SELECT ${META_COLS} FROM ai_chats WHERE id = ?1`, [id])!);
  }
  requireId(input.id);
  const n = db.run(`UPDATE ai_chats SET title = ?2, task = ?3, own_docs = ?4, entries = ?5, state = ?6, updated_at = ?7 WHERE id = ?1`, [input.id, title, input.task, own, entries, state, ts]);
  if (!n) throw CoreError.notFound("Unterhaltung nicht gefunden.");
  return meta(db.get<Row>(`SELECT ${META_COLS} FROM ai_chats WHERE id = ?1`, [input.id])!);
}

export function remove(db: Db, id: string): void {
  requireId(id);
  db.run("DELETE FROM ai_chats WHERE id = ?1", [id]);
}

export function clear(db: Db): void {
  db.run("DELETE FROM ai_chats");
}
