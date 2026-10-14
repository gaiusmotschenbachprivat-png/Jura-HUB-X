//! Einfache Schlüssel-Wert-Einstellungen (JSON-Werte).

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::{Error, Result};

const ALLOWED_PREFIXES: &[&str] = &["ui.", "backup.", "editor.", "onboarding."];

fn check_key(key: &str) -> Result<()> {
    if key.len() > 64 || !ALLOWED_PREFIXES.iter().any(|p| key.starts_with(p)) {
        return Err(Error::invalid("Unbekannte Einstellung."));
    }
    Ok(())
}

pub fn get(conn: &Connection, key: &str) -> Result<Option<Value>> {
    let v: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()?;
    Ok(v.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn set(conn: &Connection, key: &str, value: &Value) -> Result<()> {
    check_key(key)?;
    let s = serde_json::to_string(value)?;
    if s.len() > 16 * 1024 {
        return Err(Error::invalid("Der Wert ist zu groß."));
    }
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, s],
    )?;
    Ok(())
}

pub fn all(conn: &Connection) -> Result<serde_json::Map<String, Value>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut m = serde_json::Map::new();
    for r in rows {
        let (k, v) = r?;
        if let Ok(v) = serde_json::from_str(&v) {
            m.insert(k, v);
        }
    }
    Ok(m)
}
