//! PDF-Markierungen, Kommentare und Lesezeichen. Die PDF-Datei bleibt unverändert.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::search::{self, Entity};
use crate::util::{new_id, now, require_id};
use crate::{Error, Result};

pub const COLORS: &[&str] = &["gelb", "gruen", "blau", "rot", "lila"];

/// Rechteck relativ zur Seite (0..1), unabhängig vom Zoom.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct Annotation {
    pub id: String,
    pub document_id: String,
    pub page: i64,
    pub kind: String,
    pub color: String,
    pub rects: Vec<Rect>,
    pub quote: String,
    pub comment: String,
    pub created_at: String,
    pub updated_at: String,
}

fn from_row(r: &Row) -> rusqlite::Result<Annotation> {
    let rects: String = r.get("rects")?;
    Ok(Annotation {
        id: r.get("id")?,
        document_id: r.get("document_id")?,
        page: r.get("page")?,
        kind: r.get("kind")?,
        color: r.get("color")?,
        rects: serde_json::from_str(&rects).unwrap_or_default(),
        quote: r.get("quote")?,
        comment: r.get("comment")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

#[derive(Debug, Deserialize, Clone)]
pub struct NewAnnotation {
    pub document_id: String,
    pub page: i64,
    pub kind: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub rects: Vec<Rect>,
    #[serde(default)]
    pub quote: String,
    #[serde(default)]
    pub comment: String,
}

fn clean(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control() || *c == '\n').take(max).collect::<String>().trim().to_string()
}

fn check_rects(rects: &[Rect]) -> Result<()> {
    if rects.len() > 500 {
        return Err(Error::invalid("Zu viele Bereiche in einer Markierung."));
    }
    let ok = rects.iter().all(|r| {
        [r.x, r.y, r.w, r.h].iter().all(|v| v.is_finite()) && (-0.01..=1.01).contains(&r.x) && (-0.01..=1.01).contains(&r.y) && r.w >= 0.0 && r.h >= 0.0 && r.w <= 1.02 && r.h <= 1.02
    });
    if ok {
        Ok(())
    } else {
        Err(Error::invalid("Ungültige Position der Markierung."))
    }
}

fn index(conn: &Connection, a: &Annotation) -> Result<()> {
    if a.kind != "highlight" {
        return Ok(());
    }
    let title: String = conn.query_row("SELECT title FROM documents WHERE id = ?1", [&a.document_id], |r| r.get(0))?;
    search::put(conn, Entity::Annotation, &a.id, None, Some(a.page), &title, &format!("{} {}", a.quote, a.comment))
}

pub fn get(conn: &Connection, id: &str) -> Result<Annotation> {
    require_id(id)?;
    conn.query_row("SELECT * FROM annotations WHERE id = ?1", [id], from_row)
        .optional()?
        .ok_or_else(|| Error::not_found("Markierung nicht gefunden."))
}

pub fn create(conn: &Connection, a: NewAnnotation) -> Result<Annotation> {
    require_id(&a.document_id)?;
    if !["highlight", "bookmark"].contains(&a.kind.as_str()) {
        return Err(Error::invalid("Unbekannte Art der Markierung."));
    }
    if a.page < 1 {
        return Err(Error::invalid("Ungültige Seitenzahl."));
    }
    let color = a.color.unwrap_or_else(|| "gelb".into());
    if !COLORS.contains(&color.as_str()) {
        return Err(Error::invalid("Unbekannte Farbe."));
    }
    check_rects(&a.rects)?;
    if a.kind == "highlight" && a.rects.is_empty() {
        return Err(Error::invalid("Die Markierung hat keinen Bereich."));
    }
    let tx = conn.unchecked_transaction()?;
    crate::repo::documents::get(&tx, None, &a.document_id)?;
    if a.kind == "bookmark" {
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM annotations WHERE document_id = ?1 AND page = ?2 AND kind = 'bookmark'",
                params![a.document_id, a.page],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            let found = get(&tx, &id)?;
            tx.commit()?;
            return Ok(found);
        }
    }
    let id = new_id();
    let ts = now();
    tx.execute(
        "INSERT INTO annotations (id, document_id, page, kind, color, rects, quote, comment, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![id, a.document_id, a.page, a.kind, color, serde_json::to_string(&a.rects)?, clean(&a.quote, 5000), clean(&a.comment, 10000), ts],
    )?;
    let ann = get(&tx, &id)?;
    index(&tx, &ann)?;
    tx.commit()?;
    Ok(ann)
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct AnnotationPatch {
    pub comment: Option<String>,
    pub color: Option<String>,
}

pub fn update(conn: &Connection, id: &str, p: AnnotationPatch) -> Result<Annotation> {
    let tx = conn.unchecked_transaction()?;
    let mut a = get(&tx, id)?;
    if let Some(c) = p.comment {
        a.comment = clean(&c, 10000);
    }
    if let Some(c) = p.color {
        if !COLORS.contains(&c.as_str()) {
            return Err(Error::invalid("Unbekannte Farbe."));
        }
        a.color = c;
    }
    a.updated_at = now();
    tx.execute(
        "UPDATE annotations SET comment = ?2, color = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, a.comment, a.color, a.updated_at],
    )?;
    index(&tx, &a)?;
    tx.commit()?;
    Ok(a)
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    let tx = conn.unchecked_transaction()?;
    search::remove(&tx, Entity::Annotation, id)?;
    tx.execute("DELETE FROM annotations WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

pub fn list(conn: &Connection, document_id: &str) -> Result<Vec<Annotation>> {
    require_id(document_id)?;
    let mut stmt = conn.prepare("SELECT * FROM annotations WHERE document_id = ?1 ORDER BY page, created_at")?;
    let rows = stmt.query_map([document_id], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn reindex_all(conn: &Connection) -> Result<()> {
    let rows: Vec<Annotation> =
        conn.prepare("SELECT * FROM annotations")?.query_map([], from_row)?.collect::<rusqlite::Result<_>>()?;
    for a in rows {
        index(conn, &a)?;
    }
    Ok(())
}
