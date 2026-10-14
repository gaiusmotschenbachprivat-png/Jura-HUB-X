/** Aufgaben, offene Fragen, Lernziele und Prüfungstermine – Port von `repo/planning.rs`. */
import type { Exam, ExamInput, NewTask, Task, TaskFilter, TaskPatch } from "../../api/types";
import type { Db } from "../db";
import { CoreError } from "../errors";
import * as search from "../search";
import { cleanTitle, newId, now, requireId, takeChars } from "../util";
import * as areas from "./areas";
import * as nodes from "./nodes";

export const TASK_KINDS: readonly string[] = ["aufgabe", "frage", "lernziel"];

/** Steuerzeichen außer Zeilenumbruch (wie `!c.is_control() || c == '\n'`). */
// eslint-disable-next-line no-control-regex
const CONTROL_NO_NL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

function clean(s: string | null | undefined, max: number): string {
  return takeChars(String(s ?? "").replace(CONTROL_NO_NL, ""), max).trim();
}

function isValidYmd(d: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  if (mo < 1 || mo > 12 || day < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  return day <= dim;
}

/** Erlaubt `JJJJ-MM-TT` (oder leer). */
export function cleanDate(s: string | null | undefined): string | null {
  const d = s == null ? "" : String(s).trim();
  if (!d) return null;
  if (isValidYmd(d)) return d;
  throw CoreError.invalid("Bitte ein gültiges Datum angeben.");
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

// ---------- Aufgaben ----------

function indexTask(db: Db, t: Task): void {
  search.put(db, "task", t.id, t.area_id, null, t.title, t.notes);
}

export function taskGet(db: Db, id: string): Task {
  requireId(id);
  const t = db.get<Task>("SELECT * FROM tasks WHERE id = ?1", [id]);
  if (!t) throw CoreError.notFound("Aufgabe nicht gefunden.");
  return t;
}

export function taskCreate(db: Db, t: NewTask): Task {
  const kind = t.kind ?? "aufgabe";
  if (!TASK_KINDS.includes(kind)) throw CoreError.invalid("Unbekannte Art.");
  const title = cleanTitle(t.title, 500);
  const due = cleanDate(t.due_date);
  const nodeId = t.node_id ?? null;
  return db.tx(() => {
    // Bereich aus dem Strukturknoten übernehmen, falls nicht angegeben
    const area = t.area_id == null && nodeId !== null ? nodes.get(db, nodeId).area_id : (t.area_id ?? null);
    checkRefs(db, area, nodeId);
    const id = newId();
    const ts = now();
    db.run(
      "INSERT INTO tasks (id, area_id, node_id, kind, title, notes, due_date, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)",
      [id, area, nodeId, kind, title, clean(t.notes ?? "", 10000), due, ts],
    );
    const task = taskGet(db, id);
    indexTask(db, task);
    return task;
  });
}

export function taskUpdate(db: Db, id: string, p: TaskPatch): Task {
  return db.tx(() => {
    const t = taskGet(db, id);
    if (p.title != null) t.title = cleanTitle(p.title, 500);
    if (p.notes != null) t.notes = clean(p.notes, 10000);
    if (p.kind != null) {
      if (!TASK_KINDS.includes(p.kind)) throw CoreError.invalid("Unbekannte Art.");
      t.kind = p.kind;
    }
    // `null` = Feld leeren, fehlend = unverändert (wie `double_option`)
    if (p.due_date !== undefined) t.due_date = cleanDate(p.due_date);
    if (p.done != null) t.done_at = p.done ? (t.done_at ?? now()) : null;
    if (p.node_id !== undefined) t.node_id = p.node_id;
    checkRefs(db, t.area_id, t.node_id);
    t.updated_at = now();
    db.run(
      "UPDATE tasks SET title=?2, notes=?3, kind=?4, due_date=?5, done_at=?6, node_id=?7, updated_at=?8 WHERE id=?1",
      [id, t.title, t.notes, t.kind, t.due_date, t.done_at, t.node_id, t.updated_at],
    );
    indexTask(db, t);
    return t;
  });
}

export function taskList(db: Db, f: TaskFilter = {}): Task[] {
  return db.all<Task>(
    `SELECT * FROM tasks WHERE deleted_at IS NULL
       AND (?1 IS NULL OR area_id = ?1 OR area_id IS NULL)
       AND (?2 IS NULL OR node_id = ?2)
       AND (?3 = 1 OR done_at IS NULL)
       AND (?4 IS NULL OR kind = ?4)
     ORDER BY done_at IS NOT NULL, due_date IS NULL, due_date, created_at`,
    [f.area_id ?? null, f.node_id ?? null, f.include_done ? 1 : 0, f.kind ?? null],
  );
}

// ---------- Prüfungen ----------

function indexExam(db: Db, e: Exam): void {
  search.put(db, "exam", e.id, e.area_id, null, e.title, `${e.kind} ${e.place} ${e.notes}`);
}

export function examGet(db: Db, id: string): Exam {
  requireId(id);
  const e = db.get<Exam>("SELECT * FROM exams WHERE id = ?1", [id]);
  if (!e) throw CoreError.notFound("Prüfungstermin nicht gefunden.");
  return e;
}

function validateExam(i: ExamInput): [string, string] {
  const title = cleanTitle(i.title ?? "", 300);
  const date = cleanDate(i.date ?? "");
  if (date === null) throw CoreError.invalid("Bitte ein Datum angeben.");
  return [title, date];
}

export function examSave(db: Db, id: string | null | undefined, i: ExamInput): Exam {
  const [title, date] = validateExam(i);
  const nodeId = i.node_id ?? null;
  return db.tx(() => {
    const area = i.area_id == null && nodeId !== null ? nodes.get(db, nodeId).area_id : (i.area_id ?? null);
    checkRefs(db, area, nodeId);
    const ts = now();
    const vals = [clean(i.time, 40), clean(i.place, 200), clean(i.kind, 80), clean(i.notes, 10000)];
    let examId: string;
    if (id != null) {
      examGet(db, id);
      db.run(
        "UPDATE exams SET area_id=?2, node_id=?3, title=?4, date=?5, time=?6, place=?7, kind=?8, notes=?9, updated_at=?10 WHERE id=?1",
        [id, area, nodeId, title, date, ...vals, ts],
      );
      examId = id;
    } else {
      examId = newId();
      db.run(
        `INSERT INTO exams (id, area_id, node_id, title, date, time, place, kind, notes, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`,
        [examId, area, nodeId, title, date, ...vals, ts],
      );
    }
    const e = examGet(db, examId);
    indexExam(db, e);
    return e;
  });
}

/** Prüfungen ab `from` (JJJJ-MM-TT), aufsteigend nach Datum. */
export function examList(db: Db, areaId: string | null | undefined, from: string | null | undefined): Exam[] {
  return db.all<Exam>(
    `SELECT * FROM exams WHERE deleted_at IS NULL
       AND (?1 IS NULL OR area_id = ?1 OR area_id IS NULL)
       AND (?2 IS NULL OR date >= ?2)
     ORDER BY date, time`,
    [areaId ?? null, from ?? null],
  );
}

// ---------- Papierkorb ----------

function tableFor(kind: string): "tasks" | "exams" {
  if (kind === "task") return "tasks";
  if (kind === "exam") return "exams";
  throw CoreError.invalid("Unbekannter Eintrag.");
}

export function trash(db: Db, kind: string, id: string): void {
  requireId(id);
  const table = tableFor(kind);
  db.run(`UPDATE ${table} SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL`, [id, now()]);
}

export function restore(db: Db, kind: string, id: string): void {
  requireId(id);
  const table = tableFor(kind);
  db.run(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?1`, [id]);
}

export function purge(db: Db, kind: string, id: string): void {
  requireId(id);
  const table = tableFor(kind);
  const entity = kind === "task" ? "task" : "exam";
  db.tx(() => {
    const row = db.get<{ deleted_at: string | null }>(`SELECT deleted_at FROM ${table} WHERE id = ?1`, [id]);
    if (!row || row.deleted_at === null) {
      throw CoreError.invalid("Nur Einträge im Papierkorb können endgültig gelöscht werden.");
    }
    search.remove(db, entity, id);
    db.run(`DELETE FROM ${table} WHERE id = ?1`, [id]);
  });
}

export function reindexAll(db: Db): void {
  for (const t of db.all<Task>("SELECT * FROM tasks")) indexTask(db, t);
  for (const e of db.all<Exam>("SELECT * FROM exams")) indexExam(db, e);
}

// ---------- Befehle (wie `commands/learning.rs`) ----------

export const tasksList = (db: Db, filter: TaskFilter) => taskList(db, filter);
export const taskTrash = (db: Db, id: string) => trash(db, "task", id);
export const examsList = (db: Db, areaId: string | null, from: string | null) => examList(db, areaId, from);
export const examTrash = (db: Db, id: string) => trash(db, "exam", id);
