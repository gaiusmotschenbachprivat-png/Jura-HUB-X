//! Lokale Volltextsuche mit SQLite FTS5.
//!
//! Der Index wird in derselben Transaktion gepflegt wie die Inhalte. Treffer in
//! gelöschten Inhalten (Papierkorb) werden bei der Abfrage herausgefiltert.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::repo::nodes::breadcrumb;
use crate::Result;

/// Markierungen für Treffer im Text. Steuerzeichen, damit kein HTML entsteht;
/// die Oberfläche ersetzt sie nach dem Escapen durch `<mark>`.
pub const HL_START: &str = "\u{2}";
pub const HL_END: &str = "\u{3}";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Entity {
    /// Strukturknoten (Semester, Modul, Veranstaltung …)
    Node,
    /// Notiz
    Note,
    /// Dokument (Titel, Dateiname)
    Document,
    /// Seite eines Dokuments
    Page,
}

impl Entity {
    pub fn as_str(self) -> &'static str {
        match self {
            Entity::Node => "node",
            Entity::Note => "note",
            Entity::Document => "document",
            Entity::Page => "page",
        }
    }
}

pub fn remove(conn: &Connection, entity: Entity, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM search_index WHERE entity_type = ?1 AND entity_id = ?2",
        params![entity.as_str(), id],
    )?;
    Ok(())
}

pub fn put(
    conn: &Connection,
    entity: Entity,
    id: &str,
    area_id: Option<&str>,
    page: Option<i64>,
    title: &str,
    body: &str,
) -> Result<()> {
    if entity == Entity::Page {
        conn.execute(
            "DELETE FROM search_index WHERE entity_type = 'page' AND entity_id = ?1 AND page = ?2",
            params![id, page],
        )?;
    } else {
        remove(conn, entity, id)?;
    }
    conn.execute(
        "INSERT INTO search_index (entity_type, entity_id, area_id, page, title, body)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![entity.as_str(), id, area_id, page, title, body],
    )?;
    Ok(())
}

/// Wandelt eine Benutzereingabe in eine sichere FTS5-Abfrage um.
/// Jedes Wort wird als Präfix gesucht, alle Wörter müssen vorkommen.
/// Sonderzeichen der FTS-Syntax werden entfernt, damit Eingaben wie
/// `§ 433 BGB` oder `"Anspruch` nie zu Syntaxfehlern führen.
pub fn build_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split(|c: char| c.is_whitespace() || "\"'()*:^{}[]-+,;.§!?/\\<>=&|".contains(c))
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .take(12)
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct SearchHit {
    pub entity_type: String,
    pub entity_id: String,
    pub area_id: Option<String>,
    pub page: Option<i64>,
    /// Titel mit Treffermarkierungen (`HL_START`/`HL_END`)
    pub title: String,
    /// Kontextausschnitt mit Treffermarkierungen
    pub snippet: String,
    /// Fundort, z. B. „WS 2026/27 › BGB AT › Termin 3“
    pub path: String,
    /// Art des Strukturknotens (bei Knoten und Notizen)
    pub kind: Option<String>,
}

pub fn search(conn: &Connection, input: &str, area_id: Option<&str>, limit: i64) -> Result<Vec<SearchHit>> {
    let Some(q) = build_query(input) else {
        return Ok(vec![]);
    };
    let limit = limit.clamp(1, 200);
    let mut stmt = conn.prepare(
        "SELECT s.entity_type, s.entity_id, s.area_id, s.page,
                highlight(search_index, 4, ?3, ?4),
                snippet(search_index, 5, ?3, ?4, '…', 14)
         FROM search_index s
         WHERE search_index MATCH ?1
           AND (
             (s.entity_type IN ('node','note') AND EXISTS (
                SELECT 1 FROM nodes n WHERE n.id = s.entity_id AND n.deleted_at IS NULL))
             OR
             (s.entity_type IN ('document','page') AND EXISTS (
                SELECT 1 FROM documents d WHERE d.id = s.entity_id AND d.deleted_at IS NULL))
           )
           AND (
             ?2 IS NULL
             OR s.area_id = ?2
             OR EXISTS (SELECT 1 FROM node_area_refs r WHERE r.node_id = s.entity_id AND r.area_id = ?2)
             OR (s.entity_type IN ('document','page') AND EXISTS (
                  SELECT 1 FROM placements p JOIN nodes n ON n.id = p.node_id
                  WHERE p.document_id = s.entity_id AND n.area_id = ?2 AND n.deleted_at IS NULL))
           )
         ORDER BY bm25(search_index, 0.0, 0.0, 0.0, 0.0, 8.0, 1.0)
         LIMIT ?5",
    )?;
    let rows = stmt.query_map(params![q, area_id, HL_START, HL_END, limit], |r| {
        Ok(SearchHit {
            entity_type: r.get(0)?,
            entity_id: r.get(1)?,
            area_id: r.get(2)?,
            page: r.get(3)?,
            title: r.get(4)?,
            snippet: r.get(5)?,
            path: String::new(),
            kind: None,
        })
    })?;
    let mut hits = Vec::new();
    for h in rows {
        let mut h = h?;
        match h.entity_type.as_str() {
            "node" | "note" => {
                h.path = breadcrumb(conn, &h.entity_id, false)?;
                h.kind = conn
                    .query_row("SELECT kind FROM nodes WHERE id = ?1", [&h.entity_id], |r| r.get(0))
                    .ok();
            }
            _ => {
                h.path = crate::repo::documents::placement_summary(conn, &h.entity_id)?;
            }
        }
        hits.push(h);
    }
    Ok(hits)
}

/// Baut den gesamten Index aus den Daten neu auf (z. B. nach einer Wiederherstellung).
pub fn rebuild(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM search_index", [])?;
    crate::repo::nodes::reindex_all(&tx)?;
    tx.execute(
        "INSERT INTO search_index (entity_type, entity_id, area_id, page, title, body)
         SELECT 'document', d.id, NULL, NULL, d.title, d.original_name FROM documents d",
        [],
    )?;
    tx.execute(
        "INSERT INTO search_index (entity_type, entity_id, area_id, page, title, body)
         SELECT 'page', p.document_id, NULL, p.page_no, d.title, p.text
         FROM document_pages p JOIN documents d ON d.id = p.document_id",
        [],
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_escapes_fts_syntax() {
        assert_eq!(build_query("§ 433 BGB").unwrap(), "\"433\"* \"BGB\"*");
        assert_eq!(build_query("\"Anspruch OR (x").unwrap(), "\"Anspruch\"* \"OR\"* \"x\"*");
        assert!(build_query("  §§ ").is_none());
    }
}
