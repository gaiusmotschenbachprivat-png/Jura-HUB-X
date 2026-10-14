//! Papierkorb: Löschen ist zuerst immer umkehrbar.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::files::BlobStore;
use crate::repo::{links, nodes};
use crate::search::{self, Entity};
use crate::util::{now, require_id};
use crate::{Error, Result};

#[derive(Debug, Serialize, Clone)]
pub struct TrashItem {
    /// `node` oder `document`
    pub item_type: String,
    pub id: String,
    pub title: String,
    pub kind: Option<String>,
    pub area_id: Option<String>,
    pub deleted_at: String,
    /// Anzahl mitgelöschter Unterelemente
    pub children: i64,
    pub path: String,
}

/// Verschiebt einen Knoten samt Unterknoten in den Papierkorb.
pub fn trash_node(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    let tx = conn.unchecked_transaction()?;
    let node = nodes::get(&tx, id)?;
    if node.deleted_at.is_some() {
        return Ok(());
    }
    let ts = now();
    for sid in nodes::subtree_ids(&tx, id)? {
        tx.execute(
            "UPDATE nodes SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![sid, ts],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Stellt einen beliebigen Eintrag aus dem Papierkorb wieder her.
pub fn restore_any(conn: &Connection, item_type: &str, id: &str) -> Result<()> {
    match item_type {
        "node" => restore_node(conn, id),
        "document" => restore_document(conn, id),
        "knowledge" => crate::repo::knowledge::restore(conn, id),
        "card" => crate::repo::cards::restore(conn, id),
        "task" | "exam" => crate::repo::planning::restore(conn, item_type, id),
        _ => Err(Error::invalid("Unbekannter Eintrag.")),
    }
}

/// Löscht einen Eintrag aus dem Papierkorb endgültig.
pub fn purge_any(conn: &Connection, store: &BlobStore, item_type: &str, id: &str) -> Result<()> {
    match item_type {
        "node" => purge_node(conn, id),
        "document" => purge_document(conn, store, id),
        "knowledge" => crate::repo::knowledge::purge(conn, id),
        "card" => crate::repo::cards::purge(conn, id),
        "task" | "exam" => crate::repo::planning::purge(conn, item_type, id),
        _ => Err(Error::invalid("Unbekannter Eintrag.")),
    }
}

/// Holt einen Knoten zurück. Liegt der Elternknoten selbst im Papierkorb,
/// landet der Knoten auf der obersten Ebene seines Studienbereichs.
pub fn restore_node(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    let tx = conn.unchecked_transaction()?;
    let node = nodes::get(&tx, id)?;
    let Some(ts) = node.deleted_at.clone() else { return Ok(()) };
    for sid in nodes::subtree_ids(&tx, id)? {
        tx.execute(
            "UPDATE nodes SET deleted_at = NULL WHERE id = ?1 AND deleted_at = ?2",
            params![sid, ts],
        )?;
    }
    if let Some(p) = &node.parent_id {
        let parent = nodes::get(&tx, p)?;
        if parent.deleted_at.is_some() {
            tx.execute("UPDATE nodes SET parent_id = NULL WHERE id = ?1", [id])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn trash_document(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    conn.execute(
        "UPDATE documents SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now()],
    )?;
    Ok(())
}

pub fn restore_document(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    conn.execute("UPDATE documents SET deleted_at = NULL WHERE id = ?1", [id])?;
    Ok(())
}

pub fn list(conn: &Connection) -> Result<Vec<TrashItem>> {
    let mut out = Vec::new();
    // Nur die "obersten" gelöschten Knoten: Elternknoten nicht im selben Löschvorgang.
    let mut stmt = conn.prepare(
        "SELECT n.id, n.title, n.kind, n.area_id, n.deleted_at,
                (SELECT COUNT(*) FROM nodes c WHERE c.deleted_at = n.deleted_at AND c.id != n.id) AS cnt
         FROM nodes n LEFT JOIN nodes p ON p.id = n.parent_id
         WHERE n.deleted_at IS NOT NULL AND (p.id IS NULL OR p.deleted_at IS NULL OR p.deleted_at != n.deleted_at)
         ORDER BY n.deleted_at DESC",
    )?;
    let rows: Vec<(String, String, String, String, String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (id, title, kind, area, del, cnt) in rows {
        out.push(TrashItem {
            item_type: "node".into(),
            path: nodes::breadcrumb(conn, &id, false)?,
            id,
            title,
            kind: Some(kind),
            area_id: Some(area),
            deleted_at: del,
            children: cnt,
        });
    }
    let mut stmt = conn.prepare(
        "SELECT id, title, deleted_at FROM documents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
    )?;
    let rows: Vec<(String, String, String)> =
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    for (id, title, del) in rows {
        out.push(TrashItem {
            item_type: "document".into(),
            id,
            title,
            kind: None,
            area_id: None,
            deleted_at: del,
            children: 0,
            path: String::new(),
        });
    }
    // Wissensobjekte, Karteikarten, Aufgaben und Prüfungstermine
    let extra = [
        ("knowledge", "SELECT id, title, type, area_id, deleted_at FROM knowledge WHERE deleted_at IS NOT NULL"),
        ("card", "SELECT id, front, 'card', area_id, deleted_at FROM flashcards WHERE deleted_at IS NOT NULL"),
        ("task", "SELECT id, title, kind, area_id, deleted_at FROM tasks WHERE deleted_at IS NOT NULL"),
        ("exam", "SELECT id, title, 'exam', area_id, deleted_at FROM exams WHERE deleted_at IS NOT NULL"),
    ];
    for (item_type, sql) in extra {
        let mut stmt = conn.prepare(sql)?;
        let rows: Vec<(String, String, String, Option<String>, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (id, title, kind, area, del) in rows {
            out.push(TrashItem {
                item_type: item_type.into(),
                id,
                title: title.chars().take(200).collect(),
                kind: Some(kind),
                area_id: area,
                deleted_at: del,
                children: 0,
                path: String::new(),
            });
        }
    }
    out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(out)
}

/// Löscht einen Knoten (samt Unterknoten) endgültig. Nur für Einträge im Papierkorb.
pub fn purge_node(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    let tx = conn.unchecked_transaction()?;
    let node = nodes::get(&tx, id)?;
    if node.deleted_at.is_none() {
        return Err(Error::invalid("Nur Einträge im Papierkorb können endgültig gelöscht werden."));
    }
    for sid in nodes::subtree_ids(&tx, id)? {
        search::remove(&tx, Entity::Node, &sid)?;
        search::remove(&tx, Entity::Note, &sid)?;
        links::remove_for_entity(&tx, "node", &sid)?;
    }
    tx.execute("DELETE FROM nodes WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

/// Löscht ein Dokument endgültig. Die Datei wird nur entfernt, wenn kein
/// anderes Dokument sie noch verwendet.
pub fn purge_document(conn: &Connection, store: &BlobStore, id: &str) -> Result<()> {
    require_id(id)?;
    let tx = conn.unchecked_transaction()?;
    let (sha, del): (String, Option<String>) =
        tx.query_row("SELECT blob_sha, deleted_at FROM documents WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?;
    if del.is_none() {
        return Err(Error::invalid("Nur Dokumente im Papierkorb können endgültig gelöscht werden."));
    }
    search::remove(&tx, Entity::Document, id)?;
    tx.execute("DELETE FROM search_index WHERE entity_type = 'page' AND entity_id = ?1", [id])?;
    links::remove_for_entity(&tx, "document", id)?;
    tx.execute("DELETE FROM documents WHERE id = ?1", [id])?;
    // Datei bleibt, solange ein anderes Dokument oder ein Bild in einer Notiz sie nutzt.
    let still_used: i64 = tx.query_row(
        "SELECT (SELECT COUNT(*) FROM documents WHERE blob_sha = ?1)
              + (SELECT COUNT(*) FROM notes WHERE instr(content_json, ?1) > 0)
              + (SELECT COUNT(*) FROM note_versions WHERE instr(content_json, ?1) > 0)",
        [&sha],
        |r| r.get(0),
    )?;
    if still_used == 0 {
        tx.execute("DELETE FROM blobs WHERE sha256 = ?1", [&sha])?;
    }
    tx.commit()?;
    // Datei erst nach erfolgreichem Commit entfernen.
    if still_used == 0 {
        store.remove(&sha)?;
    }
    Ok(())
}
