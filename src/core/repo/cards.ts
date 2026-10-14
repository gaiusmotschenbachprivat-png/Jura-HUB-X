/**
 * Karteikarten und Wiederholungen – Port von `repo/cards.rs`.
 *
 * Die Planung (wann eine Karte wieder fällig ist) berechnet die Oberfläche mit
 * der Bibliothek `ts-fsrs` (FSRS-Verfahren). Der Kern prüft die übergebenen
 * Werte, speichert den neuen Stand und protokolliert jede Wiederholung in
 * einer Transaktion.
 */
import type { Card, CardFilter, CardPatch, CardStats, NewCard, ReviewInput } from "../../api/types";
import type { Db } from "../db";
import { CoreError } from "../errors";
import * as search from "../search";
import { newId, now, requireId, takeChars } from "../util";
import * as areas from "./areas";
import * as nodes from "./nodes";

export const KINDS: readonly string[] = ["frage", "definition", "norm"];

const DAY_MS = 86_400_000;

type CardRow = Omit<Card, "difficult" | "suspended"> & { difficult: number; suspended: number };

function fromRow(r: CardRow): Card {
  return {
    id: r.id,
    area_id: r.area_id,
    node_id: r.node_id,
    kind: r.kind,
    front: r.front,
    back: r.back,
    tags: r.tags,
    source_type: r.source_type,
    source_id: r.source_id,
    difficult: Number(r.difficult) !== 0,
    suspended: Number(r.suspended) !== 0,
    due: r.due,
    stability: Number(r.stability),
    difficulty: Number(r.difficulty),
    elapsed_days: Number(r.elapsed_days),
    scheduled_days: Number(r.scheduled_days),
    learning_steps: Number(r.learning_steps),
    reps: Number(r.reps),
    lapses: Number(r.lapses),
    state: Number(r.state),
    last_review: r.last_review,
    created_at: r.created_at,
    updated_at: r.updated_at,
    deleted_at: r.deleted_at,
  };
}

/** Steuerzeichen außer Zeilenumbruch (wie `!c.is_control() || c == '\n'`). */
// eslint-disable-next-line no-control-regex
const CONTROL_NO_NL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

/** `str::trim` in Rust (Unicode-Eigenschaft White_Space). */
function trim(s: string): string {
  return s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}

function cleanText(s: string | null | undefined, max: number): string {
  return trim(takeChars(String(s ?? "").replace(CONTROL_NO_NL, ""), max));
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|([+-])(\d{2}):(\d{2}))$/;

/**
 * Strenges RFC-3339 wie `OffsetDateTime::parse(s, &Rfc3339)` im Rust-Kern
 * (`util::parse_ts` in Rust; `parseTs` in util.ts ist großzügiger).
 * Liefert Millisekunden seit 1970 und den Text so, wie ihn `time` wieder
 * formatieren würde (gleicher Versatz, „Z“ für UTC, ohne Nullen am Ende des Bruchteils).
 */
export function parseRfc3339(s: string): { ms: number; text: string } | null {
  const m = RFC3339.exec(String(s ?? ""));
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number, number];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (dim === undefined || d < 1 || d > dim || h > 23 || mi > 59 || se > 59) return null;
  let off = 0;
  if (m[9]) {
    const oh = Number(m[10]);
    const om = Number(m[11]);
    if (oh > 23 || om > 59) return null;
    off = (m[9] === "-" ? -1 : 1) * (oh * 60 + om);
  }
  const frac = m[7] ? m[7].slice(1) : "";
  const ms = Date.UTC(y, mo - 1, d, h, mi, se) + Number(`0.${frac || "0"}`) * 1000 - off * 60_000;
  const fracOut = frac.replace(/0+$/, "");
  const offOut = off === 0 ? "Z" : `${m[9]}${m[10]}:${m[11]}`;
  const text = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${fracOut ? `.${fracOut}` : ""}${offOut}`;
  return { ms, text };
}

export function index(db: Db, c: Card): void {
  search.put(db, "card", c.id, c.area_id, null, c.front, `${c.back} ${c.tags}`);
}

export function get(db: Db, id: string): Card {
  requireId(id);
  const r = db.get<CardRow>("SELECT * FROM flashcards WHERE id = ?1", [id]);
  if (!r) throw CoreError.notFound("Karteikarte nicht gefunden.");
  return fromRow(r);
}

function checkRefs(db: Db, area: string | null, node: string | null): void {
  if (area !== null) {
    requireId(area);
    areas.get(db, area);
  }
  if (node !== null) {
    requireId(node);
    nodes.get(db, node);
  }
}

export function create(db: Db, input: NewCard): Card {
  const kind = input.kind ?? "frage";
  if (!KINDS.includes(kind)) throw CoreError.invalid("Unbekannte Kartenart.");
  const front = cleanText(input.front, 4000);
  const back = cleanText(input.back, 20000);
  if (front === "" || back === "") throw CoreError.invalid("Vorder- und Rückseite dürfen nicht leer sein.");
  const sourceType = input.source_type ?? null;
  const sourceId = input.source_id ?? null;
  if (sourceType !== null) {
    if (!["knowledge", "node", "document"].includes(sourceType)) throw CoreError.invalid("Unbekannte Quelle.");
    requireId(sourceId ?? "");
  }
  const areaId = input.area_id ?? null;
  const nodeId = input.node_id ?? null;
  return db.tx(() => {
    checkRefs(db, areaId, nodeId);
    const id = newId();
    const ts = now();
    db.run(
      `INSERT INTO flashcards (id, area_id, node_id, kind, front, back, tags, source_type, source_id, due, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?10)`,
      [id, areaId, nodeId, kind, front, back, cleanText(input.tags ?? "", 300), sourceType, sourceId, ts],
    );
    const c = get(db, id);
    index(db, c);
    return c;
  });
}

export function update(db: Db, id: string, p: CardPatch): Card {
  return db.tx(() => {
    const c = get(db, id);
    if (p.front != null) c.front = cleanText(p.front, 4000);
    if (p.back != null) c.back = cleanText(p.back, 20000);
    if (c.front === "" || c.back === "") throw CoreError.invalid("Vorder- und Rückseite dürfen nicht leer sein.");
    if (p.kind != null) {
      if (!KINDS.includes(p.kind)) throw CoreError.invalid("Unbekannte Kartenart.");
      c.kind = p.kind;
    }
    if (p.tags != null) c.tags = cleanText(p.tags, 300);
    if (p.difficult != null) c.difficult = Boolean(p.difficult);
    if (p.suspended != null) c.suspended = Boolean(p.suspended);
    // `null` entfernt die Zuordnung, fehlend = unverändert
    if (p.area_id !== undefined) c.area_id = p.area_id;
    if (p.node_id !== undefined) c.node_id = p.node_id;
    checkRefs(db, c.area_id, c.node_id);
    c.updated_at = now();
    db.run(
      "UPDATE flashcards SET front=?2, back=?3, kind=?4, tags=?5, difficult=?6, suspended=?7, area_id=?8, node_id=?9, updated_at=?10 WHERE id=?1",
      [id, c.front, c.back, c.kind, c.tags, c.difficult ? 1 : 0, c.suspended ? 1 : 0, c.area_id, c.node_id, c.updated_at],
    );
    index(db, c);
    return c;
  });
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number";

/** Speichert den neuen Planungsstand nach einer Wiederholung (berechnet mit FSRS in der Oberfläche). */
export function review(db: Db, id: string, r: ReviewInput): Card {
  if (!isInt(r.rating) || r.rating < 1 || r.rating > 4) throw CoreError.invalid("Ungültige Bewertung.");
  const dueTs = parseRfc3339(r.due);
  const valid =
    isNum(r.stability) &&
    Number.isFinite(r.stability) &&
    r.stability >= 0 &&
    isNum(r.difficulty) &&
    Number.isFinite(r.difficulty) &&
    r.difficulty >= 0 &&
    r.difficulty <= 10 &&
    isInt(r.state) &&
    r.state >= 0 &&
    r.state <= 3 &&
    isInt(r.reps) &&
    r.reps >= 0 &&
    isInt(r.lapses) &&
    r.lapses >= 0 &&
    isInt(r.scheduled_days) &&
    r.scheduled_days >= 0 &&
    isInt(r.learning_steps) &&
    r.learning_steps >= 0 &&
    isInt(r.elapsed_days) &&
    r.elapsed_days >= 0 &&
    dueTs !== null &&
    dueTs.ms !== 0;
  if (!valid) throw CoreError.invalid("Ungültiger Wiederholungsstand.");
  return db.tx(() => {
    const before = get(db, id);
    if (before.deleted_at !== null) throw CoreError.invalid("Die Karte liegt im Papierkorb.");
    const ts = now();
    db.run(
      `INSERT INTO review_log (id, card_id, rating, state_before, due_before, stability, difficulty, scheduled_days, reviewed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      [newId(), id, r.rating, before.state, before.due, r.stability, r.difficulty, r.scheduled_days, ts],
    );
    // „Schwer“ oder „Nochmal“ markiert die Karte als schwierig; „Einfach“ hebt das auf.
    const difficult = r.rating === 1 || r.rating === 2 ? true : r.rating === 4 ? false : before.difficult;
    db.run(
      `UPDATE flashcards SET due=?2, stability=?3, difficulty=?4, elapsed_days=?5, scheduled_days=?6, reps=?7, lapses=?8,
              state=?9, last_review=?10, difficult=?11, learning_steps=?12, updated_at=?10 WHERE id=?1`,
      [id, r.due, r.stability, r.difficulty, r.elapsed_days, r.scheduled_days, r.reps, r.lapses, r.state, ts, difficult ? 1 : 0, r.learning_steps],
    );
    return get(db, id);
  });
}

export function list(db: Db, f: CardFilter = {}): Card[] {
  const ts = now();
  const limit = Math.min(5000, Math.max(1, Math.trunc(Number(f.limit ?? 5000)) || 1));
  return db
    .all<CardRow>(
      `SELECT * FROM flashcards
       WHERE deleted_at IS NULL
         AND (?1 IS NULL OR area_id = ?1 OR area_id IS NULL)
         AND (?2 IS NULL OR node_id = ?2)
         AND (?3 = 0 OR (suspended = 0 AND due <= ?4))
         AND (?5 = 0 OR difficult = 1)
         AND (?6 IS NULL OR (source_type = ?6 AND source_id = ?7))
       ORDER BY CASE WHEN ?3 = 1 THEN due END, created_at DESC
       LIMIT ?8`,
      [
        f.area_id ?? null,
        f.node_id ?? null,
        f.due_only ? 1 : 0,
        ts,
        f.difficult_only ? 1 : 0,
        f.source_type ?? null,
        f.source_id ?? null,
        limit,
      ],
    )
    .map(fromRow);
}

/**
 * Zahlen für die Lernübersicht. `dayStart`: Beginn des lokalen Tages als
 * RFC-3339-Zeitpunkt (von der Oberfläche).
 */
export function stats(db: Db, areaId: string | null, dayStart: string): CardStats {
  const ts = now();
  const base = Date.parse(ts);
  const iso = (ms: number) => new Date(ms).toISOString();
  const weekAhead = iso(base + 7 * DAY_MS);
  const monthAgo = iso(base - 30 * DAY_MS);
  const weekAgo = iso(base - 7 * DAY_MS);
  const start = parseRfc3339(dayStart)?.text ?? "1970-01-01T00:00:00Z";
  const q = (sql: string, extra: string): number =>
    Number(
      db.value(
        `SELECT COUNT(*) FROM flashcards WHERE deleted_at IS NULL AND (?1 IS NULL OR area_id = ?1 OR area_id IS NULL) AND ${sql}`,
        [areaId, extra],
      ) ?? 0,
    );
  const lq = (since: string): [number, number] => {
    const r = db.get<{ n: number; ok: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN l.rating > 1 THEN 1 ELSE 0 END), 0) AS ok
       FROM review_log l JOIN flashcards c ON c.id = l.card_id
       WHERE l.reviewed_at >= ?2 AND (?1 IS NULL OR c.area_id = ?1 OR c.area_id IS NULL)`,
      [areaId, since],
    );
    return [Number(r?.n ?? 0), Number(r?.ok ?? 0)];
  };
  const [n, ok] = lq(monthAgo);
  return {
    total: q("?2 = ?2", ""),
    due_now: q("suspended = 0 AND due <= ?2", ts),
    new_cards: q("state = 0 AND ?2 = ?2", ""),
    learning: q("state IN (1, 3) AND ?2 = ?2", ""),
    review: q("state = 2 AND ?2 = ?2", ""),
    difficult: q("difficult = 1 AND ?2 = ?2", ""),
    suspended: q("suspended = 1 AND ?2 = ?2", ""),
    reviewed_today: lq(start)[0],
    reviews_7d: lq(weekAgo)[0],
    retention_30d: n > 0 ? ok / n : null,
    due_7d: q("suspended = 0 AND due <= ?2", weekAhead),
  };
}

export function trash(db: Db, id: string): void {
  requireId(id);
  db.run("UPDATE flashcards SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", [id, now()]);
}

export function restore(db: Db, id: string): void {
  requireId(id);
  db.run("UPDATE flashcards SET deleted_at = NULL WHERE id = ?1", [id]);
}

export function purge(db: Db, id: string): void {
  db.tx(() => {
    const c = get(db, id);
    if (c.deleted_at === null) throw CoreError.invalid("Nur Karten im Papierkorb können endgültig gelöscht werden.");
    search.remove(db, "card", id);
    db.run("DELETE FROM flashcards WHERE id = ?1", [id]);
  });
}

export function reindexAll(db: Db): void {
  for (const r of db.all<CardRow>("SELECT * FROM flashcards")) index(db, fromRow(r));
}
