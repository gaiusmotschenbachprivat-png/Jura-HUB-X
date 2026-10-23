//! Verlauf des KI-Assistenten. Gegenstück zu `src/core/repo/aiChats.ts` –
//! gleiche SQL-Texte, gleiche Prüfungen, gleiche Meldungen.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::util::{new_id, now, require_id};
use crate::{Error, Result};

pub const TASKS: &[&str] = &["recherche", "vertrag", "schriftsatz"];
/// Obergrenze je Feld (Verlauf mit Quellen und Denkblöcken kann groß werden)
pub const MAX_CHAT_BYTES: usize = 20 * 1024 * 1024;

const META_COLS: &str = "id, title, task, own_docs, created_at, updated_at";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct AiChatMeta {
    pub id: String,
    pub title: String,
    pub task: String,
    pub own_docs: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct AiChat {
    #[serde(flatten)]
    pub meta: AiChatMeta,
    pub entries: String,
    pub state: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiChatInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    pub task: String,
    pub own_docs: bool,
    pub entries: String,
    pub state: String,
}

fn meta_from_row(r: &Row) -> rusqlite::Result<AiChatMeta> {
    Ok(AiChatMeta {
        id: r.get(0)?,
        title: r.get(1)?,
        task: r.get(2)?,
        own_docs: r.get::<_, i64>(3)? == 1,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

pub fn clean_chat_title(s: &str) -> String {
    let t: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    let t = if t.is_empty() { "Unterhaltung".to_string() } else { t };
    t.chars().take(200).collect()
}

fn check_json<'a>(s: &'a str, what: &str) -> Result<&'a str> {
    if s.len() > MAX_CHAT_BYTES {
        return Err(Error::invalid("Die Unterhaltung ist zu lang zum Speichern. Beginne eine neue Unterhaltung."));
    }
    serde_json::from_str::<serde_json::Value>(s).map_err(|_| Error::invalid(format!("{what}: ungültiger Inhalt.")))?;
    Ok(s)
}

pub fn list(conn: &Connection) -> Result<Vec<AiChatMeta>> {
    let mut st = conn.prepare(&format!("SELECT {META_COLS} FROM ai_chats ORDER BY updated_at DESC, id DESC"))?;
    let rows = st.query_map([], meta_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn meta(conn: &Connection, id: &str) -> Result<AiChatMeta> {
    conn.query_row(&format!("SELECT {META_COLS} FROM ai_chats WHERE id = ?1"), [id], meta_from_row)
        .optional()?
        .ok_or_else(|| Error::not_found("Unterhaltung nicht gefunden."))
}

pub fn get(conn: &Connection, id: &str) -> Result<AiChat> {
    require_id(id)?;
    conn.query_row(&format!("SELECT {META_COLS}, entries, state FROM ai_chats WHERE id = ?1"), [id], |r| {
        Ok(AiChat { meta: meta_from_row(r)?, entries: r.get(6)?, state: r.get(7)? })
    })
    .optional()?
    .ok_or_else(|| Error::not_found("Unterhaltung nicht gefunden."))
}

/// Legt eine Unterhaltung an (`id` = None) oder überschreibt sie.
pub fn save(conn: &Connection, input: AiChatInput) -> Result<AiChatMeta> {
    if !TASKS.contains(&input.task.as_str()) {
        return Err(Error::invalid("Unbekannte Aufgabe."));
    }
    let title = clean_chat_title(&input.title);
    let entries = check_json(&input.entries, "Verlauf")?;
    let state = check_json(&input.state, "Verlauf")?;
    let ts = now();
    let own = i64::from(input.own_docs);
    match input.id {
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO ai_chats (id, title, task, own_docs, entries, state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![id, title, input.task, own, entries, state, ts],
            )?;
            meta(conn, &id)
        }
        Some(id) => {
            require_id(&id)?;
            let n = conn.execute(
                "UPDATE ai_chats SET title = ?2, task = ?3, own_docs = ?4, entries = ?5, state = ?6, updated_at = ?7 WHERE id = ?1",
                params![id, title, input.task, own, entries, state, ts],
            )?;
            if n == 0 {
                return Err(Error::not_found("Unterhaltung nicht gefunden."));
            }
            meta(conn, &id)
        }
    }
}

pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    conn.execute("DELETE FROM ai_chats WHERE id = ?1", [id])?;
    Ok(())
}

pub fn clear(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM ai_chats", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::configure(&c).unwrap();
        crate::db::migrate(&c, None).unwrap();
        c
    }

    fn input(id: Option<String>, title: &str) -> AiChatInput {
        AiChatInput { id, title: title.into(), task: "recherche".into(), own_docs: false, entries: "[]".into(), state: "{}".into() }
    }

    #[test]
    fn speichern_laden_loeschen() {
        let c = db();
        let m = save(&c, input(None, "  Was ist\nDiebstahl?  ")).unwrap();
        assert_eq!(m.title, "Was ist Diebstahl?");
        let mut i = input(Some(m.id.clone()), "");
        i.entries = r#"[{"role":"user","text":"x"}]"#.into();
        i.own_docs = true;
        let m2 = save(&c, i).unwrap();
        assert_eq!(m2.title, "Unterhaltung");
        assert!(m2.own_docs);
        let full = get(&c, &m.id).unwrap();
        assert!(full.entries.contains("\"x\""));
        assert_eq!(list(&c).unwrap().len(), 1);
        remove(&c, &m.id).unwrap();
        assert!(list(&c).unwrap().is_empty());
    }

    #[test]
    fn prueft_eingaben() {
        let c = db();
        let mut i = input(None, "a");
        i.task = "anders".into();
        assert!(save(&c, i).is_err());
        let mut i = input(None, "a");
        i.state = "{kaputt".into();
        assert!(save(&c, i).is_err());
        assert!(save(&c, input(Some(new_id()), "a")).is_err());
        assert!(get(&c, "../x").is_err());
    }
}
