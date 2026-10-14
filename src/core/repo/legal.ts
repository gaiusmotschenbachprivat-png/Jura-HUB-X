/**
 * Rechtsquellen für den KI-Assistenten (Gesetze, Urteile, Kommentare, eigene
 * Texte) – TypeScript-Gegenstück zu `repo/legal.rs`. Gleiche SQL-Texte.
 */
import type { LegalHit, LegalKind, LegalSource, NewLegalChunk, NewLegalSource } from "../../api/types";
import type { Db } from "../db";
import { CoreError } from "../errors";
import { cleanTitle, newId, now, requireId, takeChars } from "../util";

export const KINDS: LegalKind[] = ["gesetz", "urteil", "kommentar", "dokument"];
const MAX_CHUNKS = 50_000;
const MAX_CHUNK_CHARS = 20_000;

const SRC_COLS = "id, kind, title, abbreviation, court, file_number, decision_date, version, origin, chunk_count, imported_at";
const HIT_COLS = `c.id AS chunk_id, s.id AS source_id, s.kind, s.title, s.abbreviation, s.court, s.file_number,
  s.decision_date, s.version, c.norm, c.absatz, c.heading, c.text, c.position`;

function src(r: LegalSource): LegalSource {
  return { ...r, chunk_count: Number(r.chunk_count) };
}

function hit(r: LegalHit): LegalHit {
  return { ...r, absatz: r.absatz === null ? null : Number(r.absatz), position: Number(r.position) };
}

const clip = (s: unknown, n: number) => takeChars(String(s ?? "").trim(), n);

/** Normbezeichnung vereinheitlichen: „§433“ → „§ 433“, „Art 20“ → „Art. 20“. */
export function normalizeNorm(s: string): string {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  const m = /^(§|Art\.?|Artikel)\s*(\d+\s*[a-z]?)$/i.exec(t);
  if (!m) return t;
  const num = m[2]!.replace(/\s+/g, "").toLowerCase();
  return m[1] === "§" ? `§ ${num}` : `Art. ${num}`;
}

export function list(db: Db): LegalSource[] {
  return db.all<LegalSource>(`SELECT ${SRC_COLS} FROM legal_sources ORDER BY kind, abbreviation, title`).map(src);
}

export function get(db: Db, id: string): LegalSource {
  const r = db.get<LegalSource>(`SELECT ${SRC_COLS} FROM legal_sources WHERE id = ?1`, [id]);
  if (!r) throw CoreError.notFound("Rechtsquelle nicht gefunden.");
  return src(r);
}

/**
 * Speichert eine Quelle mit ihren Abschnitten. Ein Gesetz mit derselben
 * Abkürzung wird ersetzt (neue Fassung statt Dublette).
 */
export function save(db: Db, input: NewLegalSource, chunks: NewLegalChunk[]): LegalSource {
  if (!KINDS.includes(input.kind)) throw CoreError.invalid("Unbekannte Art von Rechtsquelle.");
  const title = cleanTitle(input.title, 300);
  if (!Array.isArray(chunks) || chunks.length === 0) throw CoreError.invalid("Die Quelle enthält keinen Text.");
  if (chunks.length > MAX_CHUNKS) throw CoreError.invalid("Die Quelle ist zu umfangreich.");
  const abbr = clip(input.abbreviation, 40);
  return db.tx(() => {
    if (input.kind === "gesetz" && abbr) {
      for (const old of db.all<{ id: string }>("SELECT id FROM legal_sources WHERE kind = 'gesetz' AND abbreviation = ?1", [abbr])) {
        removeInner(db, old.id);
      }
    }
    const id = newId();
    db.run(
      `INSERT INTO legal_sources (id, kind, title, abbreviation, court, file_number, decision_date, version, origin, chunk_count, imported_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      [
        id,
        input.kind,
        title,
        abbr,
        clip(input.court, 120),
        clip(input.file_number, 80),
        clip(input.decision_date, 20),
        clip(input.version, 300),
        clip(input.origin, 300),
        chunks.length,
        now(),
      ],
    );
    chunks.forEach((c, i) => {
      const text = takeChars(String(c.text ?? ""), MAX_CHUNK_CHARS);
      if (!text.trim()) return;
      const cid = newId();
      const norm = normalizeNorm(clip(c.norm, 40));
      const absatz = Number.isInteger(c.absatz) && (c.absatz as number) > 0 ? (c.absatz as number) : null;
      const heading = clip(c.heading, 300);
      db.run(
        "INSERT INTO legal_chunks (id, source_id, position, norm, absatz, heading, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        [cid, id, i, norm, absatz, heading, text],
      );
      db.run("INSERT INTO legal_index (chunk_id, source_id, norm, heading, text) VALUES (?1, ?2, ?3, ?4, ?5)", [cid, id, norm, heading, text]);
    });
    db.run("UPDATE legal_sources SET chunk_count = (SELECT COUNT(*) FROM legal_chunks WHERE source_id = ?1) WHERE id = ?1", [id]);
    return get(db, id);
  });
}

function removeInner(db: Db, id: string) {
  db.run("DELETE FROM legal_index WHERE source_id = ?1", [id]);
  db.run("DELETE FROM legal_chunks WHERE source_id = ?1", [id]);
  db.run("DELETE FROM legal_sources WHERE id = ?1", [id]);
}

export function remove(db: Db, id: string): void {
  requireId(id);
  db.tx(() => removeInner(db, id));
}

/** Suchbegriff für FTS5 absichern (wie `search::build_query`, aber ODER-verknüpft). */
function ftsTerm(t: string): string | null {
  const clean = t.replace(/["'()*:^{}[\]\-+,;.§!?/\\<>=&|]/g, "").trim();
  return clean ? `"${clean}"*` : null;
}

/**
 * Volltextsuche in den Rechtsquellen. `terms` werden ODER-verknüpft; BM25
 * gewichtet Treffer in Normbezeichnung und Überschrift stärker.
 */
export function search(db: Db, terms: string[], kinds: LegalKind[] | null, limit: number): LegalHit[] {
  const q = (Array.isArray(terms) ? terms : [])
    .slice(0, 24)
    .map((t) => ftsTerm(String(t)))
    .filter((t): t is string => !!t);
  if (!q.length) return [];
  const ks = (kinds ?? []).filter((k) => KINDS.includes(k));
  const lim = Math.min(50, Math.max(1, Math.trunc(Number(limit) || 8)));
  return db
    .all<LegalHit>(
      `SELECT ${HIT_COLS}
       FROM legal_index i JOIN legal_chunks c ON c.id = i.chunk_id JOIN legal_sources s ON s.id = c.source_id
       WHERE legal_index MATCH ?1 AND (?2 = '' OR instr(?2, ',' || s.kind || ',') > 0)
       ORDER BY bm25(legal_index, 0.0, 0.0, 2.0, 3.0, 1.0)
       LIMIT ?3`,
      [q.join(" OR "), ks.length ? `,${ks.join(",")},` : "", lim],
    )
    .map(hit);
}

/** Alle Abschnitte einer Norm (oder ein Absatz) eines Gesetzes. */
export function norm(db: Db, abbreviation: string, normName: string, absatz: number | null): LegalHit[] {
  const n = normalizeNorm(normName);
  const abs = Number.isInteger(absatz) && (absatz as number) > 0 ? absatz : null;
  return db
    .all<LegalHit>(
      `SELECT ${HIT_COLS}
       FROM legal_chunks c JOIN legal_sources s ON s.id = c.source_id
       WHERE s.kind = 'gesetz' AND lower(s.abbreviation) = lower(?1) AND c.norm = ?2 AND (?3 IS NULL OR c.absatz = ?3 OR c.absatz IS NULL)
       ORDER BY c.position`,
      [String(abbreviation ?? "").trim(), n, abs],
    )
    .map(hit);
}

export function chunks(db: Db, ids: string[]): LegalHit[] {
  const list = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string").slice(0, 200);
  if (!list.length) return [];
  return db
    .all<LegalHit>(
      `SELECT ${HIT_COLS} FROM legal_chunks c JOIN legal_sources s ON s.id = c.source_id
       WHERE c.id IN (SELECT value FROM json_each(?1)) ORDER BY s.title, c.position`,
      [JSON.stringify(list)],
    )
    .map(hit);
}
