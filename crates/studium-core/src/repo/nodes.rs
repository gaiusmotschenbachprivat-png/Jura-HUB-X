//! Flexibler Strukturbaum: Semester, Module, Veranstaltungen, Vorlesungstermine,
//! Themen, Ordner und Notizen. Jeder Knoten darf unter jedem anderen hängen.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::search::{self, Entity};
use crate::util::{clean_title, new_id, now, require_id};
use crate::{Error, Result};

pub const KINDS: &[&str] = &["semester", "module", "course", "session", "topic", "folder", "note"];

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Node {
    pub id: String,
    pub area_id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub position: f64,
    pub meta: Value,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub deleted_at: Option<String>,
}

pub(crate) fn from_row(r: &Row) -> rusqlite::Result<Node> {
    let meta: String = r.get("meta")?;
    Ok(Node {
        id: r.get("id")?,
        area_id: r.get("area_id")?,
        parent_id: r.get("parent_id")?,
        kind: r.get("kind")?,
        title: r.get("title")?,
        position: r.get("position")?,
        meta: serde_json::from_str(&meta).unwrap_or(Value::Object(Default::default())),
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        archived_at: r.get("archived_at")?,
        deleted_at: r.get("deleted_at")?,
    })
}

#[derive(Debug, Deserialize, Clone)]
pub struct NewNode {
    pub area_id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub meta: Option<Value>,
    /// Nur für Notizen: Startinhalt (ProseMirror-JSON) und Vorlagenname.
    #[serde(default)]
    pub content_json: Option<String>,
    #[serde(default)]
    pub plain_text: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
}

pub const EMPTY_DOC: &str = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;
const MAX_META: usize = 64 * 1024;

/// Text aus den Metadaten (Dozent, Ort, Beschreibung …) für die Suche.
pub fn meta_text(meta: &Value) -> String {
    let mut out = Vec::new();
    if let Value::Object(map) = meta {
        for v in map.values() {
            match v {
                Value::String(s) => out.push(s.clone()),
                Value::Array(a) => out.extend(a.iter().filter_map(|x| x.as_str().map(String::from))),
                _ => {}
            }
        }
    }
    out.join(" ")
}

fn clean_meta(meta: Option<Value>) -> Result<String> {
    let m = meta.unwrap_or(Value::Object(Default::default()));
    if !m.is_object() {
        return Err(Error::invalid("Zusatzangaben müssen ein Objekt sein."));
    }
    let s = serde_json::to_string(&m)?;
    if s.len() > MAX_META {
        return Err(Error::invalid("Die Zusatzangaben sind zu umfangreich."));
    }
    Ok(s)
}

pub fn get(conn: &Connection, id: &str) -> Result<Node> {
    conn.query_row("SELECT * FROM nodes WHERE id = ?1", [id], from_row)
        .optional()?
        .ok_or_else(|| Error::not_found("Eintrag nicht gefunden. Er wurde eventuell gelöscht."))
}

/// Alle nicht gelöschten Knoten eines Bereichs (oder aller Bereiche).
/// Die Oberfläche baut daraus den Baum.
pub fn list(conn: &Connection, area_id: Option<&str>) -> Result<Vec<Node>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM nodes WHERE deleted_at IS NULL AND (?1 IS NULL OR area_id = ?1)
         ORDER BY position, created_at",
    )?;
    let rows = stmt.query_map([area_id], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn next_position(conn: &Connection, parent_id: Option<&str>, area_id: &str) -> Result<f64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(position), 0) + 1024 FROM nodes
         WHERE area_id = ?2 AND ((?1 IS NULL AND parent_id IS NULL) OR parent_id = ?1)",
        params![parent_id, area_id],
        |r| r.get(0),
    )?)
}

pub fn index(conn: &Connection, n: &Node, note_text: Option<&str>) -> Result<()> {
    if n.kind == "note" {
        search::put(conn, Entity::Note, &n.id, Some(&n.area_id), None, &n.title, note_text.unwrap_or(""))
    } else {
        search::put(conn, Entity::Node, &n.id, Some(&n.area_id), None, &n.title, &meta_text(&n.meta))
    }
}

pub fn create(conn: &Connection, input: NewNode) -> Result<Node> {
    require_id(&input.area_id)?;
    if !KINDS.contains(&input.kind.as_str()) {
        return Err(Error::invalid("Unbekannte Art von Eintrag."));
    }
    let title = clean_title(&input.title, 300)?;
    let meta = clean_meta(input.meta)?;
    let tx = conn.unchecked_transaction()?;
    crate::repo::areas::get(&tx, &input.area_id)?;
    if let Some(p) = &input.parent_id {
        let parent = get(&tx, p)?;
        if parent.area_id != input.area_id {
            return Err(Error::invalid("Der übergeordnete Eintrag gehört zu einem anderen Studienbereich."));
        }
        if parent.deleted_at.is_some() {
            return Err(Error::invalid("Der übergeordnete Eintrag liegt im Papierkorb."));
        }
    }
    let id = new_id();
    let ts = now();
    let pos = next_position(&tx, input.parent_id.as_deref(), &input.area_id)?;
    tx.execute(
        "INSERT INTO nodes (id, area_id, parent_id, kind, title, position, meta, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![id, input.area_id, input.parent_id, input.kind, title, pos, meta, ts],
    )?;
    let mut text = String::new();
    if input.kind == "note" {
        let content = input.content_json.unwrap_or_else(|| EMPTY_DOC.to_string());
        crate::repo::notes::validate_content(&content)?;
        text = input.plain_text.unwrap_or_default();
        tx.execute(
            "INSERT INTO notes (node_id, content_json, plain_text, template, word_count, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, content, text, input.template, crate::util::word_count(&text), ts],
        )?;
    }
    let node = get(&tx, &id)?;
    index(&tx, &node, Some(&text))?;
    tx.commit()?;
    Ok(node)
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct NodePatch {
    pub title: Option<String>,
    pub meta: Option<Value>,
}

pub fn update(conn: &Connection, id: &str, patch: NodePatch) -> Result<Node> {
    require_id(id)?;
    let tx = conn.unchecked_transaction()?;
    let mut node = get(&tx, id)?;
    if let Some(t) = patch.title {
        node.title = clean_title(&t, 300)?;
    }
    if let Some(m) = patch.meta {
        let s = clean_meta(Some(m))?;
        node.meta = serde_json::from_str(&s)?;
    }
    let ts = now();
    tx.execute(
        "UPDATE nodes SET title = ?2, meta = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, node.title, serde_json::to_string(&node.meta)?, ts],
    )?;
    node.updated_at = ts;
    let text: Option<String> = tx
        .query_row("SELECT plain_text FROM notes WHERE node_id = ?1", [id], |r| r.get(0))
        .optional()?;
    index(&tx, &node, text.as_deref())?;
    tx.commit()?;
    Ok(node)
}

/// IDs eines Knotens und aller Nachfahren (auch gelöschter).
pub fn subtree_ids(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE t(id) AS (
            SELECT ?1
            UNION ALL
            SELECT n.id FROM nodes n JOIN t ON n.parent_id = t.id
         ) SELECT id FROM t",
    )?;
    let rows = stmt.query_map([id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Verschiebt einen Knoten unter einen neuen Elternknoten (oder auf die oberste
/// Ebene) an die angegebene Position. Verhindert Zyklen. Ein Wechsel des
/// Studienbereichs nimmt alle Unterknoten mit.
pub fn move_node(
    conn: &Connection,
    id: &str,
    new_parent: Option<&str>,
    position: f64,
    area_id: Option<&str>,
) -> Result<Node> {
    require_id(id)?;
    if !position.is_finite() {
        return Err(Error::invalid("Ungültige Position."));
    }
    let tx = conn.unchecked_transaction()?;
    let node = get(&tx, id)?;
    let target_area = match new_parent {
        Some(p) => {
            let parent = get(&tx, p)?;
            if subtree_ids(&tx, id)?.iter().any(|x| x == p) {
                return Err(Error::invalid("Ein Eintrag kann nicht in sich selbst verschoben werden."));
            }
            parent.area_id
        }
        None => area_id.map(String::from).unwrap_or(node.area_id.clone()),
    };
    crate::repo::areas::get(&tx, &target_area)?;
    let ts = now();
    tx.execute(
        "UPDATE nodes SET parent_id = ?2, position = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, new_parent, position, ts],
    )?;
    if target_area != node.area_id {
        for sid in subtree_ids(&tx, id)? {
            tx.execute("UPDATE nodes SET area_id = ?2 WHERE id = ?1", params![sid, target_area])?;
            tx.execute(
                "UPDATE search_index SET area_id = ?2 WHERE entity_id = ?1 AND entity_type IN ('node','note')",
                params![sid, target_area],
            )?;
            tx.execute(
                "DELETE FROM node_area_refs WHERE node_id = ?1 AND area_id = ?2",
                params![sid, target_area],
            )?;
        }
    }
    let n = get(&tx, id)?;
    tx.commit()?;
    Ok(n)
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool) -> Result<Node> {
    require_id(id)?;
    let val = if archived { Some(now()) } else { None };
    let n = conn.execute("UPDATE nodes SET archived_at = ?2 WHERE id = ?1", params![id, val])?;
    if n == 0 {
        return Err(Error::not_found("Eintrag nicht gefunden."));
    }
    get(conn, id)
}

/// Pfad eines Knotens als Text, z. B. „WS 2026/27 › BGB AT › Termin 3“.
pub fn breadcrumb(conn: &Connection, id: &str, include_self: bool) -> Result<String> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE up(id, parent_id, title, depth) AS (
            SELECT id, parent_id, title, 0 FROM nodes WHERE id = ?1
            UNION ALL
            SELECT n.id, n.parent_id, n.title, up.depth + 1 FROM nodes n JOIN up ON n.id = up.parent_id
            WHERE up.depth < 64
         ) SELECT title, depth FROM up ORDER BY depth DESC",
    )?;
    let rows = stmt.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    let mut parts = Vec::new();
    for row in rows {
        let (title, depth) = row?;
        if depth > 0 || include_self {
            parts.push(title);
        }
    }
    Ok(parts.join(" › "))
}

// ---- Bereichsübergreifende Verweise ("auch relevant für") ----

pub fn add_area_ref(conn: &Connection, node_id: &str, area_id: &str) -> Result<()> {
    require_id(node_id)?;
    require_id(area_id)?;
    let node = get(conn, node_id)?;
    crate::repo::areas::get(conn, area_id)?;
    if node.area_id == area_id {
        return Err(Error::invalid("Der Eintrag gehört bereits zu diesem Studienbereich."));
    }
    conn.execute(
        "INSERT OR IGNORE INTO node_area_refs (node_id, area_id) VALUES (?1, ?2)",
        params![node_id, area_id],
    )?;
    Ok(())
}

pub fn remove_area_ref(conn: &Connection, node_id: &str, area_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM node_area_refs WHERE node_id = ?1 AND area_id = ?2",
        params![node_id, area_id],
    )?;
    Ok(())
}

/// Knoten anderer Bereiche, die in diesem Bereich als „auch relevant“ erscheinen.
pub fn list_area_refs(conn: &Connection, area_id: &str) -> Result<Vec<Node>> {
    let mut stmt = conn.prepare(
        "SELECT n.* FROM nodes n JOIN node_area_refs r ON r.node_id = n.id
         WHERE r.area_id = ?1 AND n.deleted_at IS NULL ORDER BY n.title",
    )?;
    let rows = stmt.query_map([area_id], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Bereiche, in denen ein Knoten zusätzlich erscheint.
pub fn area_refs_of(conn: &Connection, node_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT area_id FROM node_area_refs WHERE node_id = ?1")?;
    let rows = stmt.query_map([node_id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Neu indexieren aller Knoten (für `search::rebuild`).
pub fn reindex_all(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare(
        "SELECT n.*, t.plain_text AS note_text FROM nodes n LEFT JOIN notes t ON t.node_id = n.id",
    )?;
    let rows: Vec<(Node, Option<String>)> = stmt
        .query_map([], |r| Ok((from_row(r)?, r.get("note_text")?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (n, text) in rows {
        index(conn, &n, text.as_deref())?;
    }
    Ok(())
}
