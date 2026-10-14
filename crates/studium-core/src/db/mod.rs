//! Datenbankverbindung und Migrationen.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::util::file_stamp;
use crate::{Error, Result};

pub const DB_FILE: &str = "studium.sqlite";

/// Alle Migrationen in Reihenfolge. Index + 1 = Schemaversion.
/// Neue Migrationen werden nur hinten angehängt, bestehende nie verändert.
const MIGRATIONS: &[&str] = &[include_str!("migrations/0001_init.sql")];

/// Höchste Schemaversion, die diese App-Version versteht.
pub const SCHEMA_VERSION: i64 = MIGRATIONS.len() as i64;

pub fn db_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DB_FILE)
}

/// Öffnet (oder erstellt) die Datenbank im Datenordner und bringt das Schema
/// auf den aktuellen Stand. Vor jeder Migration einer bestehenden Datenbank
/// wird ein Schnappschuss in `pre-migration/` angelegt.
pub fn open(data_dir: &Path) -> Result<Connection> {
    std::fs::create_dir_all(data_dir)?;
    let conn = Connection::open(db_path(data_dir))?;
    configure(&conn)?;
    migrate(&conn, Some(data_dir))?;
    Ok(conn)
}

/// Öffnet eine Datenbankdatei nur lesend (für Prüfungen und Backups).
pub fn open_readonly(path: &Path) -> Result<Connection> {
    let conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    Ok(conn)
}

pub fn configure(conn: &Connection) -> Result<()> {
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         PRAGMA foreign_keys = ON;
         PRAGMA trusted_schema = OFF;",
    )?;
    Ok(())
}

pub fn schema_version(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

/// Führt fehlende Migrationen aus, jede in einer eigenen Transaktion.
pub fn migrate(conn: &Connection, data_dir: Option<&Path>) -> Result<()> {
    let current = schema_version(conn)?;
    if current > SCHEMA_VERSION {
        return Err(Error::invalid(format!(
            "Die Datenbank stammt von einer neueren Version von Studium OS (Schema {current}). \
             Bitte aktualisiere die App. Deine Daten wurden nicht verändert."
        )));
    }
    if current == SCHEMA_VERSION {
        return Ok(());
    }
    if current > 0 {
        if let Some(dir) = data_dir {
            snapshot_before_migration(conn, dir, current)?;
        }
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let version = i as i64 + 1;
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {version};"))?;
        tx.commit()?;
        log::info!("Datenbankschema auf Version {version} aktualisiert");
    }
    Ok(())
}

fn snapshot_before_migration(conn: &Connection, data_dir: &Path, version: i64) -> Result<()> {
    let dir = data_dir.join("pre-migration");
    std::fs::create_dir_all(&dir)?;
    let target = dir.join(format!("studium-schema{version}-{}.sqlite", file_stamp()));
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])?;
    log::info!("Sicherung vor Migration angelegt");
    Ok(())
}

/// `PRAGMA integrity_check` – liefert `Ok(())` nur bei „ok“.
pub fn integrity_check(conn: &Connection) -> Result<()> {
    let res: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if res == "ok" {
        Ok(())
    } else {
        Err(Error::BackupCorrupt(format!("Datenbankprüfung meldet: {res}")))
    }
}
