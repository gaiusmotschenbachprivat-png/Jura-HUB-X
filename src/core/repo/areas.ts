/** Studienbereiche – Port von `repo/areas.rs`. */
import type { Area } from "../../api/types";
import type { Db } from "../db";
import { CoreError } from "../errors";
import { cleanTitle, newId, now, requireId } from "../util";

const COLS = "id, name, color, position, archived_at, created_at";

/** Erlaubt nur `#rrggbb`, damit keine beliebigen CSS-Werte gespeichert werden. */
export function cleanColor(c: string): string {
  const t = String(c ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
  throw CoreError.invalid("Die Farbe muss im Format #rrggbb angegeben werden.");
}

function fromRow(r: Area): Area {
  return { ...r, position: Number(r.position) };
}

export function list(db: Db): Area[] {
  return db.all<Area>(`SELECT ${COLS} FROM areas ORDER BY position, created_at`).map(fromRow);
}

export function get(db: Db, id: string): Area {
  const r = db.get<Area>(`SELECT ${COLS} FROM areas WHERE id = ?1`, [id]);
  if (!r) throw CoreError.notFound("Studienbereich nicht gefunden.");
  return fromRow(r);
}

export function create(db: Db, name: string, color: string): Area {
  const n = cleanTitle(name, 80);
  const c = cleanColor(color);
  const id = newId();
  const ts = now();
  const pos = Number(db.value("SELECT COALESCE(MAX(position), -1) + 1 FROM areas") ?? 0);
  db.run("INSERT INTO areas (id, name, color, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)", [
    id,
    n,
    c,
    pos,
    ts,
  ]);
  return get(db, id);
}

export function update(db: Db, id: string, name: string, color: string): Area {
  requireId(id);
  const n = cleanTitle(name, 80);
  const c = cleanColor(color);
  const changed = db.run("UPDATE areas SET name = ?2, color = ?3, updated_at = ?4 WHERE id = ?1", [id, n, c, now()]);
  if (changed === 0) throw CoreError.notFound("Studienbereich nicht gefunden.");
  return get(db, id);
}

export function reorder(db: Db, ids: string[]): void {
  db.tx(() => {
    ids.forEach((id, i) => db.run("UPDATE areas SET position = ?2 WHERE id = ?1", [id, i]));
  });
}

export function setArchived(db: Db, id: string, archived: boolean): Area {
  requireId(id);
  db.run("UPDATE areas SET archived_at = ?2 WHERE id = ?1", [id, archived ? now() : null]);
  return get(db, id);
}
