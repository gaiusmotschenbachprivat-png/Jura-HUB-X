//! Aufgaben, offene Fragen, Lernziele und Prüfungstermine.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::repo::knowledge::double_option;
use crate::search::{self, Entity};
use crate::util::{clean_title, new_id, now, require_id};
use crate::{Error, Result};

pub const TASK_KINDS: &[&str] = &["aufgabe", "frage", "lernziel"];

fn clean(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control() || *c == '\n').take(max).collect::<String>().trim().to_string()
}

/// Erlaubt `JJJJ-MM-TT` (oder leer).
fn clean_date(s: Option<&str>) -> Result<Option<String>> {
    match s.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(d) => {
            let ok = d.len() == 10
                && time::Date::parse(d, time::macros::format_description!("[year]-[month]-[day]")).is_ok();
            if ok {
                Ok(Some(d.to_string()))
            } else {
                Err(Error::invalid("Bitte ein gültiges Datum angeben."))
            }
        }
    }
}

fn check_refs(conn: &Connection, area: Option<&str>, node: Option<&str>) -> Result<()> {
    if let Some(a) = area {
        require_id(a)?;
        crate::repo::areas::get(conn, a)?;
    }
    if let Some(n) = node {
        require_id(n)?;
        crate::repo::nodes::get(conn, n)?;
    }
    Ok(())
}

// ---------- Aufgaben ----------

#[derive(Debug, Serialize, Clone)]
pub struct Task {
    pub id: String,
    pub area_id: Option<String>,
    pub node_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub notes: String,
    pub due_date: Option<String>,
    pub done_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

fn task_row(r: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get("id")?,
        area_id: r.get("area_id")?,
        node_id: r.get("node_id")?,
        kind: r.get("kind")?,
        title: r.get("title")?,
        notes: r.get("notes")?,
        due_date: r.get("due_date")?,
        done_at: r.get("done_at")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        deleted_at: r.get("deleted_at")?,
    })
}

#[derive(Debug, Deserialize, Clone)]
pub struct NewTask {
    #[serde(default)]
    pub area_id: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default = "default_task_kind")]
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub due_date: Option<String>,
}

fn default_task_kind() -> String {
    "aufgabe".into()
}

fn index_task(conn: &Connection, t: &Task) -> Result<()> {
    search::put(conn, Entity::Task, &t.id, t.area_id.as_deref(), None, &t.title, &t.notes)
}

pub fn task_get(conn: &Connection, id: &str) -> Result<Task> {
    require_id(id)?;
    conn.query_row("SELECT * FROM tasks WHERE id = ?1", [id], task_row)
        .optional()?
        .ok_or_else(|| Error::not_found("Aufgabe nicht gefunden."))
}

pub fn task_create(conn: &Connection, t: NewTask) -> Result<Task> {
    if !TASK_KINDS.contains(&t.kind.as_str()) {
        return Err(Error::invalid("Unbekannte Art."));
    }
    let title = clean_title(&t.title, 500)?;
    let due = clean_date(t.due_date.as_deref())?;
    let tx = conn.unchecked_transaction()?;
    // Bereich aus dem Strukturknoten übernehmen, falls nicht angegeben
    let area = match (&t.area_id, &t.node_id) {
        (None, Some(n)) => Some(crate::repo::nodes::get(&tx, n)?.area_id),
        (a, _) => a.clone(),
    };
    check_refs(&tx, area.as_deref(), t.node_id.as_deref())?;
    let id = new_id();
    let ts = now();
    tx.execute(
        "INSERT INTO tasks (id, area_id, node_id, kind, title, notes, due_date, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)",
        params![id, area, t.node_id, t.kind, title, clean(&t.notes, 10000), due, ts],
    )?;
    let task = task_get(&tx, &id)?;
    index_task(&tx, &task)?;
    tx.commit()?;
    Ok(task)
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct TaskPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub kind: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_date: Option<Option<String>>,
    pub done: Option<bool>,
    #[serde(default, deserialize_with = "double_option")]
    pub node_id: Option<Option<String>>,
}

pub fn task_update(conn: &Connection, id: &str, p: TaskPatch) -> Result<Task> {
    let tx = conn.unchecked_transaction()?;
    let mut t = task_get(&tx, id)?;
    if let Some(v) = p.title {
        t.title = clean_title(&v, 500)?;
    }
    if let Some(v) = p.notes {
        t.notes = clean(&v, 10000);
    }
    if let Some(v) = p.kind {
        if !TASK_KINDS.contains(&v.as_str()) {
            return Err(Error::invalid("Unbekannte Art."));
        }
        t.kind = v;
    }
    if let Some(v) = p.due_date {
        t.due_date = clean_date(v.as_deref())?;
    }
    if let Some(done) = p.done {
        t.done_at = if done { t.done_at.or_else(|| Some(now())) } else { None };
    }
    if let Some(v) = p.node_id {
        t.node_id = v;
    }
    check_refs(&tx, t.area_id.as_deref(), t.node_id.as_deref())?;
    t.updated_at = now();
    tx.execute(
        "UPDATE tasks SET title=?2, notes=?3, kind=?4, due_date=?5, done_at=?6, node_id=?7, updated_at=?8 WHERE id=?1",
        params![id, t.title, t.notes, t.kind, t.due_date, t.done_at, t.node_id, t.updated_at],
    )?;
    index_task(&tx, &t)?;
    tx.commit()?;
    Ok(t)
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct TaskFilter {
    pub area_id: Option<String>,
    pub node_id: Option<String>,
    #[serde(default)]
    pub include_done: bool,
    pub kind: Option<String>,
}

pub fn task_list(conn: &Connection, f: &TaskFilter) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM tasks WHERE deleted_at IS NULL
           AND (?1 IS NULL OR area_id = ?1 OR area_id IS NULL)
           AND (?2 IS NULL OR node_id = ?2)
           AND (?3 = 1 OR done_at IS NULL)
           AND (?4 IS NULL OR kind = ?4)
         ORDER BY done_at IS NOT NULL, due_date IS NULL, due_date, created_at",
    )?;
    let rows = stmt.query_map(params![f.area_id, f.node_id, f.include_done as i64, f.kind], task_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

// ---------- Prüfungen ----------

#[derive(Debug, Serialize, Clone)]
pub struct Exam {
    pub id: String,
    pub area_id: Option<String>,
    pub node_id: Option<String>,
    pub title: String,
    pub date: String,
    pub time: String,
    pub place: String,
    pub kind: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

fn exam_row(r: &Row) -> rusqlite::Result<Exam> {
    Ok(Exam {
        id: r.get("id")?,
        area_id: r.get("area_id")?,
        node_id: r.get("node_id")?,
        title: r.get("title")?,
        date: r.get("date")?,
        time: r.get("time")?,
        place: r.get("place")?,
        kind: r.get("kind")?,
        notes: r.get("notes")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        deleted_at: r.get("deleted_at")?,
    })
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(default)]
pub struct ExamInput {
    pub area_id: Option<String>,
    pub node_id: Option<String>,
    pub title: String,
    pub date: String,
    pub time: String,
    pub place: String,
    pub kind: String,
    pub notes: String,
}

fn index_exam(conn: &Connection, e: &Exam) -> Result<()> {
    search::put(conn, Entity::Exam, &e.id, e.area_id.as_deref(), None, &e.title, &format!("{} {} {}", e.kind, e.place, e.notes))
}

pub fn exam_get(conn: &Connection, id: &str) -> Result<Exam> {
    require_id(id)?;
    conn.query_row("SELECT * FROM exams WHERE id = ?1", [id], exam_row)
        .optional()?
        .ok_or_else(|| Error::not_found("Prüfungstermin nicht gefunden."))
}

fn validate_exam(i: &ExamInput) -> Result<(String, String)> {
    let title = clean_title(&i.title, 300)?;
    let date = clean_date(Some(&i.date))?.ok_or_else(|| Error::invalid("Bitte ein Datum angeben."))?;
    Ok((title, date))
}

pub fn exam_save(conn: &Connection, id: Option<&str>, i: ExamInput) -> Result<Exam> {
    let (title, date) = validate_exam(&i)?;
    let tx = conn.unchecked_transaction()?;
    let area = match (&i.area_id, &i.node_id) {
        (None, Some(n)) => Some(crate::repo::nodes::get(&tx, n)?.area_id),
        (a, _) => a.clone(),
    };
    check_refs(&tx, area.as_deref(), i.node_id.as_deref())?;
    let ts = now();
    let id = match id {
        Some(id) => {
            exam_get(&tx, id)?;
            tx.execute(
                "UPDATE exams SET area_id=?2, node_id=?3, title=?4, date=?5, time=?6, place=?7, kind=?8, notes=?9, updated_at=?10 WHERE id=?1",
                params![id, area, i.node_id, title, date, clean(&i.time, 40), clean(&i.place, 200), clean(&i.kind, 80), clean(&i.notes, 10000), ts],
            )?;
            id.to_string()
        }
        None => {
            let id = new_id();
            tx.execute(
                "INSERT INTO exams (id, area_id, node_id, title, date, time, place, kind, notes, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
                params![id, area, i.node_id, title, date, clean(&i.time, 40), clean(&i.place, 200), clean(&i.kind, 80), clean(&i.notes, 10000), ts],
            )?;
            id
        }
    };
    let e = exam_get(&tx, &id)?;
    index_exam(&tx, &e)?;
    tx.commit()?;
    Ok(e)
}

/// Prüfungen ab `from` (JJJJ-MM-TT), aufsteigend nach Datum.
pub fn exam_list(conn: &Connection, area_id: Option<&str>, from: Option<&str>) -> Result<Vec<Exam>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM exams WHERE deleted_at IS NULL
           AND (?1 IS NULL OR area_id = ?1 OR area_id IS NULL)
           AND (?2 IS NULL OR date >= ?2)
         ORDER BY date, time",
    )?;
    let rows = stmt.query_map(params![area_id, from], exam_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

// ---------- Papierkorb ----------

pub fn trash(conn: &Connection, table: &str, id: &str) -> Result<()> {
    require_id(id)?;
    let table = match table {
        "task" => "tasks",
        "exam" => "exams",
        _ => return Err(Error::invalid("Unbekannter Eintrag.")),
    };
    conn.execute(&format!("UPDATE {table} SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL"), params![id, now()])?;
    Ok(())
}

pub fn restore(conn: &Connection, table: &str, id: &str) -> Result<()> {
    require_id(id)?;
    let table = match table {
        "task" => "tasks",
        "exam" => "exams",
        _ => return Err(Error::invalid("Unbekannter Eintrag.")),
    };
    conn.execute(&format!("UPDATE {table} SET deleted_at = NULL WHERE id = ?1"), [id])?;
    Ok(())
}

pub fn purge(conn: &Connection, kind: &str, id: &str) -> Result<()> {
    require_id(id)?;
    let (table, entity) = match kind {
        "task" => ("tasks", Entity::Task),
        "exam" => ("exams", Entity::Exam),
        _ => return Err(Error::invalid("Unbekannter Eintrag.")),
    };
    let tx = conn.unchecked_transaction()?;
    let deleted: Option<Option<String>> =
        tx.query_row(&format!("SELECT deleted_at FROM {table} WHERE id = ?1"), [id], |r| r.get(0)).optional()?;
    if !matches!(deleted, Some(Some(_))) {
        return Err(Error::invalid("Nur Einträge im Papierkorb können endgültig gelöscht werden."));
    }
    search::remove(&tx, entity, id)?;
    tx.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])?;
    tx.commit()?;
    Ok(())
}

pub fn reindex_all(conn: &Connection) -> Result<()> {
    let tasks: Vec<Task> = conn.prepare("SELECT * FROM tasks")?.query_map([], task_row)?.collect::<rusqlite::Result<_>>()?;
    for t in tasks {
        index_task(conn, &t)?;
    }
    let exams: Vec<Exam> = conn.prepare("SELECT * FROM exams")?.query_map([], exam_row)?.collect::<rusqlite::Result<_>>()?;
    for e in exams {
        index_exam(conn, &e)?;
    }
    Ok(())
}
