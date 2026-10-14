/** PDF-Markierungen, Kommentare und Lesezeichen – Port von `repo/annotations.rs`. Die PDF-Datei bleibt unverändert. */
import type { Annotation, AnnotationColor, NewAnnotation, Rect } from "../../api/types";
import type { Db } from "../db";
import { CoreError } from "../errors";
import * as search from "../search";
import { newId, now, parseJson, requireId, takeChars } from "../util";

export const COLORS: readonly string[] = ["gelb", "gruen", "blau", "rot", "lila"];

export interface AnnotationPatch {
  comment?: string | null;
  color?: AnnotationColor | null;
}

type AnnotationRow = Omit<Annotation, "rects" | "page"> & { rects: string; page: number | bigint };

function isRect(v: unknown): v is Rect {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return ["x", "y", "w", "h"].every((k) => typeof r[k] === "number");
}

/** Wie `serde_json::from_str::<Vec<Rect>>(…).unwrap_or_default()`. */
function parseRects(s: string): Rect[] {
  const v = parseJson<unknown>(s, []);
  if (!Array.isArray(v) || !v.every(isRect)) return [];
  return v.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
}

function fromRow(r: AnnotationRow): Annotation {
  return {
    id: r.id,
    document_id: r.document_id,
    page: Number(r.page),
    kind: r.kind,
    color: r.color,
    rects: parseRects(r.rects),
    quote: r.quote,
    comment: r.comment,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** Steuerzeichen außer Zeilenumbruch. */
// eslint-disable-next-line no-control-regex
const CONTROL_NO_NL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

function clean(s: string | null | undefined, max: number): string {
  return takeChars(String(s ?? "").replace(CONTROL_NO_NL, ""), max).trim();
}

const inRange = (v: number) => v >= -0.01 && v <= 1.01;

function checkRects(rects: unknown[]): asserts rects is Rect[] {
  if (rects.length > 500) throw CoreError.invalid("Zu viele Bereiche in einer Markierung.");
  const ok = rects.every(
    (r) =>
      isRect(r) &&
      [r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v)) &&
      inRange(r.x) &&
      inRange(r.y) &&
      r.w >= 0 &&
      r.h >= 0 &&
      r.w <= 1.02 &&
      r.h <= 1.02,
  );
  if (!ok) throw CoreError.invalid("Ungültige Position der Markierung.");
}

function index(db: Db, a: Annotation): void {
  if (a.kind !== "highlight") return;
  const title = db.value<string>("SELECT title FROM documents WHERE id = ?1", [a.document_id]);
  if (title === undefined) throw CoreError.notFound("Dokument nicht gefunden.");
  search.put(db, "annotation", a.id, null, a.page, title, `${a.quote} ${a.comment}`);
}

export function get(db: Db, id: string): Annotation {
  requireId(id);
  const r = db.get<AnnotationRow>("SELECT * FROM annotations WHERE id = ?1", [id]);
  if (!r) throw CoreError.notFound("Markierung nicht gefunden.");
  return fromRow(r);
}

export function create(db: Db, a: NewAnnotation): Annotation {
  requireId(a.document_id);
  if (!["highlight", "bookmark"].includes(a.kind)) throw CoreError.invalid("Unbekannte Art der Markierung.");
  if (typeof a.page !== "number" || !Number.isInteger(a.page) || a.page < 1) {
    throw CoreError.invalid("Ungültige Seitenzahl.");
  }
  const color = a.color ?? "gelb";
  if (!COLORS.includes(color)) throw CoreError.invalid("Unbekannte Farbe.");
  const rects: unknown[] = Array.isArray(a.rects) ? a.rects : [];
  checkRects(rects);
  if (a.kind === "highlight" && rects.length === 0) throw CoreError.invalid("Die Markierung hat keinen Bereich.");
  return db.tx(() => {
    // wie `documents::get`: Dokument (mit Datei-Eintrag) muss existieren
    const exists = db.value("SELECT 1 FROM documents d JOIN blobs b ON b.sha256 = d.blob_sha WHERE d.id = ?1", [
      a.document_id,
    ]);
    if (exists === undefined) throw CoreError.notFound("Dokument nicht gefunden.");
    if (a.kind === "bookmark") {
      const existing = db.value<string>(
        "SELECT id FROM annotations WHERE document_id = ?1 AND page = ?2 AND kind = 'bookmark'",
        [a.document_id, a.page],
      );
      if (existing !== undefined) return get(db, existing);
    }
    const id = newId();
    const ts = now();
    const stored = JSON.stringify(rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })));
    db.run(
      `INSERT INTO annotations (id, document_id, page, kind, color, rects, quote, comment, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
      [id, a.document_id, a.page, a.kind, color, stored, clean(a.quote, 5000), clean(a.comment, 10000), ts],
    );
    const ann = get(db, id);
    index(db, ann);
    return ann;
  });
}

export function update(db: Db, id: string, p: AnnotationPatch): Annotation {
  return db.tx(() => {
    const a = get(db, id);
    if (p.comment != null) a.comment = clean(p.comment, 10000);
    if (p.color != null) {
      if (!COLORS.includes(p.color)) throw CoreError.invalid("Unbekannte Farbe.");
      a.color = p.color;
    }
    a.updated_at = now();
    db.run("UPDATE annotations SET comment = ?2, color = ?3, updated_at = ?4 WHERE id = ?1", [
      id,
      a.comment,
      a.color,
      a.updated_at,
    ]);
    index(db, a);
    return a;
  });
}

export function remove(db: Db, id: string): void {
  requireId(id);
  db.tx(() => {
    search.remove(db, "annotation", id);
    db.run("DELETE FROM annotations WHERE id = ?1", [id]);
  });
}

/** Alias mit dem Rust-Namen (`delete` ist in JS ein reserviertes Wort). */
export { remove as delete };

export function list(db: Db, documentId: string): Annotation[] {
  requireId(documentId);
  return db
    .all<AnnotationRow>("SELECT * FROM annotations WHERE document_id = ?1 ORDER BY page, created_at", [documentId])
    .map(fromRow);
}

export function reindexAll(db: Db): void {
  for (const r of db.all<AnnotationRow>("SELECT * FROM annotations")) index(db, fromRow(r));
}

// ---------- Befehle (wie `commands/learning.rs`) ----------

export const annotationsList = list;
export const annotationCreate = create;
export const annotationUpdate = update;
export const annotationDelete = remove;
