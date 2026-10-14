//! Studienbereiche (z. B. Rechtswissenschaften, Recht & Wirtschaft, WiWiZ).

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

use crate::util::{clean_title, new_id, now, require_id};
use crate::{Error, Result};

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Area {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i64,
    pub archived_at: Option<String>,
    pub created_at: String,
}

fn from_row(r: &Row) -> rusqlite::Result<Area> {
    Ok(Area {
        id: r.get("id")?,
        name: r.get("name")?,
        color: r.get("color")?,
        position: r.get("position")?,
        archived_at: r.get("archived_at")?,
        created_at: r.get("created_at")?,
    })
}

/// Erlaubt nur `#rrggbb`, damit keine beliebigen CSS-Werte gespeichert werden.
pub fn clean_color(c: &str) -> Result<String> {
    let c = c.trim();
    let ok = c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit());
    if ok {
        Ok(c.to_ascii_lowercase())
    } else {
        Err(Error::invalid("Die Farbe muss im Format #rrggbb angegeben werden."))
    }
}

pub fn list(conn: &Connection) -> Result<Vec<Area>> {
    let mut stmt = conn.prepare("SELECT * FROM areas ORDER BY position, created_at")?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Area> {
    conn.query_row("SELECT * FROM areas WHERE id = ?1", [id], from_row)
        .optional()?
        .ok_or_else(|| Error::not_found("Studienbereich nicht gefunden."))
}

pub fn create(conn: &Connection, name: &str, color: &str) -> Result<Area> {
    let name = clean_title(name, 80)?;
    let color = clean_color(color)?;
    let id = new_id();
    let ts = now();
    let pos: i64 = conn.query_row("SELECT COALESCE(MAX(position), -1) + 1 FROM areas", [], |r| r.get(0))?;
    conn.execute(
        "INSERT INTO areas (id, name, color, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, name, color, pos, ts],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, name: &str, color: &str) -> Result<Area> {
    require_id(id)?;
    let name = clean_title(name, 80)?;
    let color = clean_color(color)?;
    let n = conn.execute(
        "UPDATE areas SET name = ?2, color = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, name, color, now()],
    )?;
    if n == 0 {
        return Err(Error::not_found("Studienbereich nicht gefunden."));
    }
    get(conn, id)
}

pub fn reorder(conn: &Connection, ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute("UPDATE areas SET position = ?2 WHERE id = ?1", params![id, i as i64])?;
    }
    tx.commit()?;
    Ok(())
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool) -> Result<Area> {
    require_id(id)?;
    let val = if archived { Some(now()) } else { None };
    conn.execute("UPDATE areas SET archived_at = ?2 WHERE id = ?1", params![id, val])?;
    get(conn, id)
}
