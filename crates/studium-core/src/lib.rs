//! Kern von Studium OS: Datenbank, Struktur, Notizen, Dokumente, Suche und Backups.
//!
//! Diese Bibliothek kennt keine Oberfläche und kein Tauri. Alles hier ist mit
//! `cargo test` prüfbar.

pub mod backup;
pub mod db;
pub mod error;
pub mod files;
pub mod repo;
pub mod search;
pub mod settings;
pub mod util;

pub use error::{Error, Result};
