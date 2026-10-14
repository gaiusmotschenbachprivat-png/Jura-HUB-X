//! Notizinhalte und Versionshistorie.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::repo::nodes;
use crate::util::{new_id, now, parse_ts, require_id, word_count};
use crate::{Error, Result};

/// Höchstgröße einer Notiz (ProseMirror-JSON). Bilder liegen später als Dateien
/// im Speicher, daher reicht das für sehr lange Texte.
pub const MAX_CONTENT_BYTES: usize = 20 * 1024 * 1024;
/// Mindestabstand zwischen zwei automatischen Versionen.
pub const VERSION_INTERVAL_SECS: i64 = 10 * 60;
/// So viele Versionen werden je Notiz höchstens aufbewahrt.
pub const MAX_VERSIONS: i64 = 200;

#[derive(Debug, Serialize, Clone)]
pub struct Note {
    pub node_id: String,
    pub title: String,
    pub area_id: String,
    pub content_json: String,
    pub template: Option<String>,
    pub word_count: i64,
    pub updated_at: String,
    pub path: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct SaveResult {
    pub updated_at: String,
    pub version_created: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct VersionMeta {
    pub id: String,
    pub reason: String,
    pub created_at: String,
    pub word_count: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct RecentNote {
    pub node_id: String,
    pub title: String,
    pub area_id: String,
    pub updated_at: String,
    pub path: String,
    pub word_count: i64,
}

/// Prüft, dass der Inhalt gültiges ProseMirror-JSON mit `type: "doc"` ist.
pub fn validate_content(content: &str) -> Result<()> {
    if content.len() > MAX_CONTENT_BYTES {
        return Err(Error::invalid("Die Notiz ist zu groß (über 20 MB)."));
    }
    let v: serde_json::Value = serde_json::from_str(content)
        .map_err(|_| Error::invalid("Der Notizinhalt ist beschädigt und wurde nicht gespeichert."))?;
    if v.get("type").and_then(|t| t.as_str()) != Some("doc") {
        return Err(Error::invalid("Der Notizinhalt hat ein unbekanntes Format."));
    }
    Ok(())
}

pub fn get(conn: &Connection, node_id: &str) -> Result<Note> {
    require_id(node_id)?;
    let note = conn
        .query_row(
            "SELECT n.id, n.title, n.area_id, t.content_json, t.template, t.word_count, t.updated_at
             FROM nodes n JOIN notes t ON t.node_id = n.id WHERE n.id = ?1",
            [node_id],
            |r| {
                Ok(Note {
                    node_id: r.get(0)?,
                    title: r.get(1)?,
                    area_id: r.get(2)?,
                    content_json: r.get(3)?,
                    template: r.get(4)?,
                    word_count: r.get(5)?,
                    updated_at: r.get(6)?,
                    path: String::new(),
                })
            },
        )
        .optional()?
        .ok_or_else(|| Error::not_found("Notiz nicht gefunden. Sie wurde eventuell gelöscht."))?;
    Ok(Note { path: nodes::breadcrumb(conn, node_id, false)?, ..note })
}

/// Speichert den Inhalt einer Notiz. Inhalt, Suchindex und ggf. eine neue
/// Version werden gemeinsam in einer Transaktion geschrieben.
pub fn save(conn: &Connection, node_id: &str, content_json: &str, plain_text: &str) -> Result<SaveResult> {
    require_id(node_id)?;
    validate_content(content_json)?;
    let tx = conn.unchecked_transaction()?;
    let node = nodes::get(&tx, node_id)?;
    if node.kind != "note" {
        return Err(Error::invalid("Dieser Eintrag ist keine Notiz."));
    }
    if node.deleted_at.is_some() {
        return Err(Error::invalid("Die Notiz liegt im Papierkorb. Stelle sie zuerst wieder her."));
    }
    let ts = now();
    let wc = word_count(plain_text);
    let changed = tx.execute(
        "UPDATE notes SET content_json = ?2, plain_text = ?3, word_count = ?4, updated_at = ?5
         WHERE node_id = ?1 AND content_json != ?2",
        params![node_id, content_json, plain_text, wc, ts],
    )?;
    if changed == 0 {
        let updated_at: String =
            tx.query_row("SELECT updated_at FROM notes WHERE node_id = ?1", [node_id], |r| r.get(0))?;
        tx.commit()?;
        return Ok(SaveResult { updated_at, version_created: false });
    }
    tx.execute("UPDATE nodes SET updated_at = ?2 WHERE id = ?1", params![node_id, ts])?;
    nodes::index(&tx, &node, Some(plain_text))?;
    sync_mentions(&tx, node_id, content_json)?;

    let last: Option<String> = tx
        .query_row(
            "SELECT created_at FROM note_versions WHERE node_id = ?1 ORDER BY created_at DESC LIMIT 1",
            [node_id],
            |r| r.get(0),
        )
        .optional()?;
    let due = match last {
        None => true,
        Some(t) => (parse_ts(&ts) - parse_ts(&t)).whole_seconds() >= VERSION_INTERVAL_SECS,
    };
    if due {
        insert_version(&tx, node_id, content_json, plain_text, "Automatisch")?;
    }
    tx.commit()?;
    Ok(SaveResult { updated_at: ts, version_created: due })
}

fn insert_version(conn: &Connection, node_id: &str, content: &str, text: &str, reason: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO note_versions (id, node_id, content_json, plain_text, word_count, reason, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![new_id(), node_id, content, text, word_count(text), reason, now()],
    )?;
    // Älteste Versionen über dem Limit entfernen.
    conn.execute(
        "DELETE FROM note_versions WHERE node_id = ?1 AND id NOT IN (
            SELECT id FROM note_versions WHERE node_id = ?1 ORDER BY created_at DESC LIMIT ?2)",
        params![node_id, MAX_VERSIONS],
    )?;
    Ok(())
}

/// Legt sofort eine Version an (z. B. „Version speichern“ in der Oberfläche).
pub fn create_version(conn: &Connection, node_id: &str, reason: &str) -> Result<()> {
    require_id(node_id)?;
    let (content, text): (String, String) = conn
        .query_row("SELECT content_json, plain_text FROM notes WHERE node_id = ?1", [node_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?
        .ok_or_else(|| Error::not_found("Notiz nicht gefunden."))?;
    let reason: String = reason.chars().filter(|c| !c.is_control()).take(80).collect();
    insert_version(conn, node_id, &content, &text, if reason.trim().is_empty() { "Manuell" } else { &reason })
}

pub fn list_versions(conn: &Connection, node_id: &str) -> Result<Vec<VersionMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, reason, created_at, word_count FROM note_versions WHERE node_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([node_id], |r| {
        Ok(VersionMeta { id: r.get(0)?, reason: r.get(1)?, created_at: r.get(2)?, word_count: r.get(3)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get_version_content(conn: &Connection, version_id: &str) -> Result<String> {
    require_id(version_id)?;
    conn.query_row("SELECT content_json FROM note_versions WHERE id = ?1", [version_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error::not_found("Version nicht gefunden."))
}

/// Stellt eine alte Version wieder her. Der aktuelle Stand wird vorher selbst
/// als Version gesichert, damit nichts verloren geht.
pub fn restore_version(conn: &Connection, node_id: &str, version_id: &str) -> Result<SaveResult> {
    require_id(node_id)?;
    require_id(version_id)?;
    let tx = conn.unchecked_transaction()?;
    let (vnode, content, text): (String, String, String) = tx
        .query_row(
            "SELECT node_id, content_json, plain_text FROM note_versions WHERE id = ?1",
            [version_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| Error::not_found("Version nicht gefunden."))?;
    if vnode != node_id {
        return Err(Error::invalid("Diese Version gehört zu einer anderen Notiz."));
    }
    let (cur_c, cur_t): (String, String) = tx.query_row(
        "SELECT content_json, plain_text FROM notes WHERE node_id = ?1",
        [node_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    insert_version(&tx, node_id, &cur_c, &cur_t, "Vor Wiederherstellung")?;
    let ts = now();
    tx.execute(
        "UPDATE notes SET content_json = ?2, plain_text = ?3, word_count = ?4, updated_at = ?5 WHERE node_id = ?1",
        params![node_id, content, text, word_count(&text), ts],
    )?;
    tx.execute("UPDATE nodes SET updated_at = ?2 WHERE id = ?1", params![node_id, ts])?;
    let node = nodes::get(&tx, node_id)?;
    nodes::index(&tx, &node, Some(&text))?;
    sync_mentions(&tx, node_id, &content)?;
    tx.commit()?;
    Ok(SaveResult { updated_at: ts, version_created: true })
}

pub fn recent(conn: &Connection, area_id: Option<&str>, limit: i64) -> Result<Vec<RecentNote>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.title, n.area_id, t.updated_at, t.word_count
         FROM nodes n JOIN notes t ON t.node_id = n.id
         WHERE n.deleted_at IS NULL AND (?1 IS NULL OR n.area_id = ?1)
         ORDER BY t.updated_at DESC LIMIT ?2",
    )?;
    let rows: Vec<RecentNote> = stmt
        .query_map(params![area_id, limit.clamp(1, 100)], |r| {
            Ok(RecentNote {
                node_id: r.get(0)?,
                title: r.get(1)?,
                area_id: r.get(2)?,
                updated_at: r.get(3)?,
                word_count: r.get(4)?,
                path: String::new(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    rows.into_iter()
        .map(|n| Ok(RecentNote { path: nodes::breadcrumb(conn, &n.node_id, false)?, ..n }))
        .collect()
}

/// Ein interner Link im Notiztext: `studium:node/<id>` oder
/// `studium:document/<id>` bzw. `studium:document/<id>#page=<n>`.
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Clone)]
pub struct Mention {
    pub target_type: String,
    pub target_id: String,
    pub page: Option<i64>,
}

pub fn parse_internal_href(href: &str) -> Option<Mention> {
    let rest = href.strip_prefix("studium:")?;
    let (kind, rest) = rest.split_once('/')?;
    let (id, frag) = match rest.split_once('#') {
        Some((a, b)) => (a, Some(b)),
        None => (rest, None),
    };
    if !crate::util::is_id(id) || !["node", "document"].contains(&kind) {
        return None;
    }
    let page = frag
        .and_then(|f| f.strip_prefix("page="))
        .and_then(|p| p.parse::<i64>().ok())
        .filter(|p| *p >= 1);
    Some(Mention { target_type: kind.into(), target_id: id.into(), page })
}

/// Sammelt alle internen Links aus einem ProseMirror-Dokument.
pub fn extract_mentions(content_json: &str) -> Vec<Mention> {
    fn walk(v: &serde_json::Value, out: &mut Vec<Mention>) {
        if let Some(marks) = v.get("marks").and_then(|m| m.as_array()) {
            for m in marks {
                if m.get("type").and_then(|t| t.as_str()) == Some("link") {
                    if let Some(h) = m.pointer("/attrs/href").and_then(|h| h.as_str()) {
                        if let Some(x) = parse_internal_href(h) {
                            out.push(x);
                        }
                    }
                }
            }
        }
        if let Some(c) = v.get("content").and_then(|c| c.as_array()) {
            for child in c {
                walk(child, out);
            }
        }
    }
    let mut out = Vec::new();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(content_json) {
        walk(&v, &mut out);
    }
    out.sort();
    out.dedup();
    out
}

/// Hält die Verknüpfungen vom Typ `mention` mit den Links im Text synchron.
/// Links auf nicht (mehr) vorhandene Ziele werden ignoriert.
fn sync_mentions(conn: &Connection, node_id: &str, content_json: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM links WHERE source_type = 'node' AND source_id = ?1 AND kind = 'mention'",
        [node_id],
    )?;
    for m in extract_mentions(content_json) {
        if m.target_type == "node" && m.target_id == node_id {
            continue;
        }
        let exists: bool = if m.target_type == "node" {
            conn.query_row("SELECT 1 FROM nodes WHERE id = ?1", [&m.target_id], |_| Ok(true)).optional()?.is_some()
        } else {
            conn.query_row("SELECT 1 FROM documents WHERE id = ?1", [&m.target_id], |_| Ok(true)).optional()?.is_some()
        };
        if !exists {
            continue;
        }
        let anchor = match m.page {
            Some(p) => serde_json::json!({ "page": p }),
            None => serde_json::json!({}),
        };
        conn.execute(
            "INSERT INTO links (id, source_type, source_id, target_type, target_id, kind, anchor, created_at)
             VALUES (?1, 'node', ?2, ?3, ?4, 'mention', ?5, ?6)",
            params![new_id(), node_id, m.target_type, m.target_id, anchor.to_string(), now()],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_internal_links() {
        let id = "01900000-0000-7000-8000-000000000001";
        assert_eq!(
            parse_internal_href(&format!("studium:document/{id}#page=7")),
            Some(Mention { target_type: "document".into(), target_id: id.into(), page: Some(7) })
        );
        assert!(parse_internal_href("https://example.org").is_none());
        assert!(parse_internal_href("studium:node/../../x").is_none());
        assert!(parse_internal_href(&format!("studium:evil/{id}")).is_none());
    }
}
