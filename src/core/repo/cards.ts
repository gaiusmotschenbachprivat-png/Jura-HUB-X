/**
 * Karteikarten und Wiederholungen – Port von `repo/cards.rs`.
 *
 * Die Planung (wann eine Karte wieder fällig ist) berechnet die Oberfläche mit
 * der Bibliothek `ts-fsrs` (FSRS-Verfahren). Der Kern prüft die übergebenen
 * Werte, speichert den neuen Stand und protokolliert jede Wiederholung in
 * einer Transaktion.
 */
import type { Card, CardFilter, CardPatch, CardStats, CardTemplate, NewCard, ReviewInput, ReviewLogEntry } from "../../api/types";
import type { Db } from "../db";
import { CoreError } from "../errors";
import * as search from "../search";
import { newId, now, requireId, takeChars } from "../util";
import * as areas from "./areas";
import * as nodes from "./nodes";

export const KINDS: readonly string[] = ["frage", "definition", "norm"];
export const TEMPLATES: readonly string[] = ["basis", "umgekehrt", "definition", "begriff", "schema", "luecke", "eingabe"];

const DAY_MS = 86_400_000;

type CardRow = Omit<Card, "difficult" | "suspended"> & { difficult: number; suspended: number };

/** Stapelpfad: Teile an „::“ (auch „:::“) getrennt, je Teil ohne Rand-Leerzeichen, leere Teile entfallen (höchstens 200 Zeichen). */
export function cleanDeck(s: string | null | undefined): string {
  return takeChars(
    String(s ?? "")
      .replace(CONTROL_NO_NL, "")
      .replace(/\n/g, " ")
      .split(/:{2,}/)
      .map((p) => trim(p))
      .filter((p) => p !== "")
      .join("::"),
    200,
  );
}

/** Zusatzfelder: JSON-Objekt mit Text je Feld (höchstens 20 Felder, 20 000 Zeichen insgesamt). */
export function cleanFields(s: string | null | undefined): string {
  let v: unknown;
  try {
    v = JSON.parse(String(s ?? "{}") || "{}");
  } catch {
    throw CoreError.invalid("Ungültige Kartenfelder.");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw CoreError.invalid("Ungültige Kartenfelder.");
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
    if (typeof val !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(k)) throw CoreError.invalid("Ungültige Kartenfelder.");
    const t = cleanText(val, 20000);
    if (t !== "") out[k] = t;
  }
  const json = JSON.stringify(out);
  if ([...json].length > 20000) throw CoreError.invalid("Die Kartenfelder sind zu lang.");
  return json;
}

function checkTemplate(t: string): CardTemplate {
  if (!TEMPLATES.includes(t)) throw CoreError.invalid("Unbekannter Kartentyp.");
  return t as CardTemplate;
}

function checkFlag(f: unknown): number {
  if (!isInt(f) || f < 0 || f > 7) throw CoreError.invalid("Ungültige Flagge.");
  return f;
}

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
    deck: r.deck ?? "",
    template: (r.template ?? "basis") as CardTemplate,
    fields: r.fields ?? "{}",
    flag: Number(r.flag ?? 0),
    buried_until: r.buried_until ?? null,
    note_key: r.note_key ?? null,
    ord: Number(r.ord ?? 0),
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
  const template = checkTemplate(input.template ?? (kind === "definition" ? "definition" : "basis"));
  const fields = cleanFields(input.fields ?? "{}");
  const noteKey = input.note_key ?? null;
  if (noteKey !== null) requireId(noteKey);
  const ord = input.ord ?? 0;
  if (!isInt(ord) || ord < 0 || ord > 99) throw CoreError.invalid("Ungültige Kartennummer.");
  return db.tx(() => {
    checkRefs(db, areaId, nodeId);
    const id = newId();
    const ts = now();
    db.run(
      `INSERT INTO flashcards (id, area_id, node_id, kind, front, back, tags, source_type, source_id, due, created_at, updated_at, deck, template, fields, note_key, ord)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?10, ?11, ?12, ?13, ?14, ?15)`,
      [id, areaId, nodeId, kind, front, back, cleanText(input.tags ?? "", 300), sourceType, sourceId, ts, cleanDeck(input.deck), template, fields, noteKey, ord],
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
    if (p.deck != null) c.deck = cleanDeck(p.deck);
    if (p.template != null) c.template = checkTemplate(p.template);
    if (p.fields != null) c.fields = cleanFields(p.fields);
    if (p.flag != null) c.flag = checkFlag(p.flag);
    if (p.buried_until !== undefined) {
      if (p.buried_until === null) c.buried_until = null;
      else {
        const t = parseRfc3339(p.buried_until);
        if (!t) throw CoreError.invalid("Ungültiger Zeitpunkt.");
        c.buried_until = t.text;
      }
    }
    checkRefs(db, c.area_id, c.node_id);
    c.updated_at = now();
    db.run(
      `UPDATE flashcards SET front=?2, back=?3, kind=?4, tags=?5, difficult=?6, suspended=?7, area_id=?8, node_id=?9, updated_at=?10,
              deck=?11, template=?12, fields=?13, flag=?14, buried_until=?15 WHERE id=?1`,
      [id, c.front, c.back, c.kind, c.tags, c.difficult ? 1 : 0, c.suspended ? 1 : 0, c.area_id, c.node_id, c.updated_at, c.deck, c.template, c.fields, c.flag, c.buried_until],
    );
    if (p.reset) {
      // „Vergessen“: wieder als neue Karte (Protokoll bleibt erhalten)
      db.run(
        `UPDATE flashcards SET due=?2, stability=0, difficulty=0, elapsed_days=0, scheduled_days=0, learning_steps=0, reps=0, lapses=0,
                state=0, last_review=NULL, difficult=0 WHERE id=?1`,
        [id, c.updated_at],
      );
      return get(db, id);
    }
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
    dueTs.ms !== 0 &&
    (r.duration_ms === undefined || r.duration_ms === null || (isInt(r.duration_ms) && r.duration_ms >= 0));
  if (!valid) throw CoreError.invalid("Ungültiger Wiederholungsstand.");
  const duration = Math.min(Number(r.duration_ms ?? 0), 3_600_000);
  return db.tx(() => {
    const before = get(db, id);
    if (before.deleted_at !== null) throw CoreError.invalid("Die Karte liegt im Papierkorb.");
    const ts = now();
    db.run(
      `INSERT INTO review_log (id, card_id, rating, state_before, due_before, stability, difficulty, scheduled_days, reviewed_at, duration_ms, before)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      [newId(), id, r.rating, before.state, before.due, r.stability, r.difficulty, r.scheduled_days, ts, duration, snapshotOf(before)],
    );
    // „Schwer“ oder „Nochmal“ markiert die Karte als schwierig; „Einfach“ hebt das auf.
    const difficult = r.rating === 1 || r.rating === 2 ? true : r.rating === 4 ? false : before.difficult;
    db.run(
      `UPDATE flashcards SET due=?2, stability=?3, difficulty=?4, elapsed_days=?5, scheduled_days=?6, reps=?7, lapses=?8,
              state=?9, last_review=?10, difficult=?11, learning_steps=?12, updated_at=?10, buried_until=NULL WHERE id=?1`,
      [id, r.due, r.stability, r.difficulty, r.elapsed_days, r.scheduled_days, r.reps, r.lapses, r.state, ts, difficult ? 1 : 0, r.learning_steps],
    );
    return get(db, id);
  });
}

/** Planungsstand vor einer Bewertung (für „Rückgängig“), als JSON */
function snapshotOf(c: Card): string {
  return JSON.stringify({
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review,
    difficult: c.difficult,
  });
}

/** Letzte Bewertung zurücknehmen: Stand davor wiederherstellen, Eintrag im Protokoll entfernen. */
export function undoReview(db: Db, id: string): Card {
  return db.tx(() => {
    get(db, id);
    const log = db.get<{ id: string; before: string }>("SELECT id, before FROM review_log WHERE card_id = ?1 ORDER BY reviewed_at DESC, rowid DESC LIMIT 1", [id]);
    let b: Record<string, unknown> | null = null;
    try {
      b = log?.before ? (JSON.parse(log.before) as Record<string, unknown>) : null;
    } catch {
      b = null;
    }
    if (!log || !b) throw CoreError.invalid("Diese Bewertung lässt sich nicht rückgängig machen.");
    const due = parseRfc3339(String(b.due ?? ""));
    const lastReview = b.last_review == null ? null : parseRfc3339(String(b.last_review));
    const raw = ["stability", "difficulty", "elapsed_days", "scheduled_days", "learning_steps", "reps", "lapses", "state"].map((k) => b![k]);
    const nums = raw.filter((v): v is number => isNum(v) && Number.isFinite(v) && v >= 0);
    if (!due || (b.last_review != null && !lastReview) || nums.length !== raw.length)
      throw CoreError.invalid("Diese Bewertung lässt sich nicht rückgängig machen.");
    db.run(
      `UPDATE flashcards SET due=?2, stability=?3, difficulty=?4, elapsed_days=?5, scheduled_days=?6, learning_steps=?7, reps=?8, lapses=?9,
              state=?10, last_review=?11, difficult=?12, updated_at=?13 WHERE id=?1`,
      [id, due.text, ...nums, lastReview?.text ?? null, b.difficult ? 1 : 0, now()],
    );
    db.run("DELETE FROM review_log WHERE id = ?1", [log.id]);
    return get(db, id);
  });
}

/** Lernprotokoll ab `since` (für Statistiken), älteste zuerst. */
export function reviewLog(db: Db, areaId: string | null, since: string): ReviewLogEntry[] {
  const from = parseRfc3339(since)?.text ?? "1970-01-01T00:00:00Z";
  return db
    .all<ReviewLogEntry>(
      `SELECT l.id, l.card_id, l.rating, l.state_before, l.scheduled_days, l.stability, l.difficulty, l.duration_ms, l.reviewed_at
       FROM review_log l JOIN flashcards c ON c.id = l.card_id
       WHERE l.reviewed_at >= ?2 AND (?1 IS NULL OR c.area_id = ?1 OR c.area_id IS NULL)
       ORDER BY l.reviewed_at
       LIMIT 200000`,
      [areaId, from],
    )
    .map((r) => ({
      id: r.id,
      card_id: r.card_id,
      rating: Number(r.rating),
      state_before: Number(r.state_before),
      scheduled_days: Number(r.scheduled_days),
      stability: Number(r.stability),
      difficulty: Number(r.difficulty),
      duration_ms: Number(r.duration_ms),
      reviewed_at: r.reviewed_at,
    }));
}

export function list(db: Db, f: CardFilter = {}): Card[] {
  const ts = now();
  const limit = Math.min(20000, Math.max(1, Math.trunc(Number(f.limit ?? 20000)) || 1));
  return db
    .all<CardRow>(
      `SELECT * FROM flashcards
       WHERE deleted_at IS NULL
         AND (?1 IS NULL OR area_id = ?1 OR area_id IS NULL)
         AND (?2 IS NULL OR node_id = ?2)
         AND (?3 = 0 OR (suspended = 0 AND due <= ?4 AND (buried_until IS NULL OR buried_until <= ?4)))
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
  // Wiederholungen je Kalendertag (ab dem übergebenen Tagesbeginn rückwärts)
  const startMs = Date.parse(start);
  const reviewsByDay = Array.from({ length: 7 }, (_, i) => {
    const from = iso(startMs - (6 - i) * DAY_MS);
    const to = iso(startMs - (5 - i) * DAY_MS);
    return Number(
      db.value(
        `SELECT COUNT(*) FROM review_log l JOIN flashcards c ON c.id = l.card_id
         WHERE l.reviewed_at >= ?2 AND l.reviewed_at < ?3 AND (?1 IS NULL OR c.area_id = ?1 OR c.area_id IS NULL)`,
        [areaId, from, to],
      ) ?? 0,
    );
  });
  return {
    total: q("?2 = ?2", ""),
    due_now: q("suspended = 0 AND due <= ?2 AND (buried_until IS NULL OR buried_until <= ?2)", ts),
    new_cards: q("state = 0 AND ?2 = ?2", ""),
    learning: q("state IN (1, 3) AND ?2 = ?2", ""),
    review: q("state = 2 AND ?2 = ?2", ""),
    difficult: q("difficult = 1 AND ?2 = ?2", ""),
    suspended: q("suspended = 1 AND ?2 = ?2", ""),
    reviewed_today: lq(start)[0],
    reviews_7d: lq(weekAgo)[0],
    retention_30d: n > 0 ? ok / n : null,
    due_7d: q("suspended = 0 AND due <= ?2", weekAhead),
    reviews_by_day: reviewsByDay,
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
