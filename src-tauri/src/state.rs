//! Anwendungszustand: eine Datenbankverbindung, Pfade, Dokumentenspeicher.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use serde::Serialize;
use studium_core::files::BlobStore;

/// Fehler, wie die Oberfläche ihn sieht: stabiler Code + verständliche Meldung.
#[derive(Debug, Serialize)]
pub struct CmdError {
    pub code: String,
    pub message: String,
}

impl From<studium_core::Error> for CmdError {
    fn from(e: studium_core::Error) -> Self {
        // Nur technische Fehler protokollieren; Meldungen enthalten keine Inhalte.
        match &e {
            studium_core::Error::Db(_) | studium_core::Error::Io(_) | studium_core::Error::Zip(_) => {
                log::error!("{}: {}", e.code(), e)
            }
            _ => log::info!("Abgelehnt ({})", e.code()),
        }
        CmdError { code: e.code().into(), message: e.to_string() }
    }
}

impl CmdError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        CmdError { code: code.into(), message: message.into() }
    }
}

pub type CmdResult<T> = Result<T, CmdError>;

pub struct AppState {
    pub data_dir: PathBuf,
    pub store: BlobStore,
    db: Mutex<Option<Connection>>,
}

impl AppState {
    pub fn open(data_dir: PathBuf) -> studium_core::Result<Self> {
        let conn = studium_core::db::open(&data_dir)?;
        let store = BlobStore::new(&data_dir)?;
        store.clean_tmp()?;
        Ok(AppState { data_dir, store, db: Mutex::new(Some(conn)) })
    }

    fn lock(&self) -> MutexGuard<'_, Option<Connection>> {
        self.db.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Führt eine Operation mit der Datenbankverbindung aus.
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> studium_core::Result<T>) -> CmdResult<T> {
        let guard = self.lock();
        let conn = guard
            .as_ref()
            .ok_or_else(|| CmdError::new("busy", "Die Datenbank wird gerade wiederhergestellt. Bitte kurz warten."))?;
        Ok(f(conn)?)
    }

    /// Schließt die Verbindung, führt `f` aus und öffnet sie danach wieder –
    /// auch wenn `f` fehlschlägt.
    pub fn with_closed<T>(&self, f: impl FnOnce() -> studium_core::Result<T>) -> CmdResult<T> {
        let mut guard = self.lock();
        if let Some(conn) = guard.take() {
            if let Err((conn, e)) = conn.close() {
                *guard = Some(conn);
                return Err(studium_core::Error::from(e).into());
            }
        }
        let result = f();
        match studium_core::db::open(&self.data_dir) {
            Ok(c) => *guard = Some(c),
            Err(e) => {
                log::error!("Datenbank konnte nach Wiederherstellung nicht geöffnet werden: {e}");
                return Err(e.into());
            }
        }
        Ok(result?)
    }

    pub fn default_backup_dir(&self) -> PathBuf {
        self.data_dir.join("backups")
    }
}
