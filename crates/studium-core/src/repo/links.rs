//! Interne Verknüpfungen zwischen Inhalten. Jede Verknüpfung ist in beide
//! Richtungen abfragbar (Rückverweise).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::util::{new_id, now, require_id};
use crate::{Error, Result};

pub const ENTITY_TYPES: &[&str] = &["node", "document"];
pub const LINK_KINDS: &[&str] = &["related", "page", "mention"];

#[derive(Debug, Deserialize, Clone)]
pub struct NewLink {
    pub source_type: String,
    pub source_id: String,
    pub target_type: String,
    pub target_id: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    /// z. B. `{"page": 12}` für eine konkrete PDF-Seite
    #[serde(default)]
    pub anchor: Option<Value>,
}

fn default_kind() -> String {
    "related".into()
}

/// Eine Verknüpfung aus Sicht eines bestimmten Inhalts.
#[derive(Debug, Serialize, Clone)]
pub struct LinkView {
    pub id: String,
    pub kind: String,
    pub anchor: Value,
    /// `outgoing`: dieser Inhalt verweist auf das Ziel; `incoming`: Rückverweis
    pub direction: String,
    pub other_type: String,
    pub other_id: String,
    pub other_title: String,
    pub other_kind: Option<String>,
    pub other_path: String,
    pub other_missing: bool,
    pub created_at: String,
}

fn check_entity(conn: &Connection, t: &str, id: &str) -> Result<()> {
    if !ENTITY_TYPES.contains(&t) {
        return Err(Error::invalid("Unbekannter Inhaltstyp für Verknüpfung."));
    }
    require_id(id)?;
    match t {
        "node" => crate::repo::nodes::get(conn, id).map(|_| ()),
        _ => crate::repo::documents::get(conn, None, id).map(|_| ()),
    }
}

pub fn add(conn: &Connection, l: NewLink) -> Result<String> {
    if !LINK_KINDS.contains(&l.kind.as_str()) {
        return Err(Error::invalid("Unbekannte Art von Verknüpfung."));
    }
    check_entity(conn, &l.source_type, &l.source_id)?;
    check_entity(conn, &l.target_type, &l.target_id)?;
    if l.source_type == l.target_type && l.source_id == l.target_id {
        return Err(Error::invalid("Ein Inhalt kann nicht mit sich selbst verknüpft werden."));
    }
    let anchor = l.anchor.unwrap_or(Value::Object(Default::default()));
    if let Some(p) = anchor.get("page") {
        if !p.as_i64().is_some_and(|p| p >= 1) {
            return Err(Error::invalid("Ungültige Seitenzahl."));
        }
    }
    let anchor_s = serde_json::to_string(&anchor)?;
    // Doppelte Verknüpfungen vermeiden
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM links WHERE source_type=?1 AND source_id=?2 AND target_type=?3 AND target_id=?4 AND anchor=?5",
            params![l.source_type, l.source_id, l.target_type, l.target_id, anchor_s],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO links (id, source_type, source_id, target_type, target_id, kind, anchor, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, l.source_type, l.source_id, l.target_type, l.target_id, l.kind, anchor_s, now()],
    )?;
    Ok(id)
}

pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    conn.execute("DELETE FROM links WHERE id = ?1", [id])?;
    Ok(())
}

fn describe(conn: &Connection, t: &str, id: &str) -> Result<(String, Option<String>, String, bool)> {
    if t == "node" {
        let row: Option<(String, String, Option<String>)> = conn
            .query_row("SELECT title, kind, deleted_at FROM nodes WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()?;
        Ok(match row {
            Some((title, kind, del)) => {
                (title, Some(kind), crate::repo::nodes::breadcrumb(conn, id, false)?, del.is_some())
            }
            None => ("(gelöscht)".into(), None, String::new(), true),
        })
    } else {
        let row: Option<(String, Option<String>)> = conn
            .query_row("SELECT title, deleted_at FROM documents WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?;
        Ok(match row {
            Some((title, del)) => (title, None, crate::repo::documents::placement_summary(conn, id)?, del.is_some()),
            None => ("(gelöscht)".into(), None, String::new(), true),
        })
    }
}

/// Alle Verknüpfungen eines Inhalts, ausgehend und eingehend.
pub fn for_entity(conn: &Connection, t: &str, id: &str) -> Result<Vec<LinkView>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, anchor, 'outgoing', target_type, target_id, created_at FROM links
           WHERE source_type = ?1 AND source_id = ?2
         UNION ALL
         SELECT id, kind, anchor, 'incoming', source_type, source_id, created_at FROM links
           WHERE target_type = ?1 AND target_id = ?2
         ORDER BY 7 DESC",
    )?;
    let rows: Vec<(String, String, String, String, String, String, String)> = stmt
        .query_map(params![t, id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut out = Vec::with_capacity(rows.len());
    for (lid, kind, anchor, dir, ot, oid, created_at) in rows {
        let (title, okind, path, missing) = describe(conn, &ot, &oid)?;
        out.push(LinkView {
            id: lid,
            kind,
            anchor: serde_json::from_str(&anchor).unwrap_or(Value::Null),
            direction: dir,
            other_type: ot,
            other_id: oid,
            other_title: title,
            other_kind: okind,
            other_path: path,
            other_missing: missing,
            created_at,
        });
    }
    Ok(out)
}

/// Entfernt alle Verknüpfungen eines endgültig gelöschten Inhalts.
pub fn remove_for_entity(conn: &Connection, t: &str, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM links WHERE (source_type = ?1 AND source_id = ?2) OR (target_type = ?1 AND target_id = ?2)",
        params![t, id],
    )?;
    Ok(())
}
