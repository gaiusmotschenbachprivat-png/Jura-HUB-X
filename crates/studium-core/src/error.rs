use std::fmt;

/// Fehler des Kerns. Die `Display`-Texte sind für Menschen gedacht und werden
/// unverändert in der Oberfläche angezeigt. Sie enthalten keine Notizinhalte.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Datenbankfehler: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Dateifehler: {0}")]
    Io(#[from] std::io::Error),
    #[error("Archivfehler: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Ungültige Daten: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    #[error("Das Backup ist unvollständig oder beschädigt: {0}")]
    BackupCorrupt(String),
}

impl Error {
    pub fn invalid(msg: impl fmt::Display) -> Self {
        Error::Invalid(msg.to_string())
    }
    pub fn not_found(msg: impl fmt::Display) -> Self {
        Error::NotFound(msg.to_string())
    }
    /// Kurzer, stabiler Code für die Oberfläche.
    pub fn code(&self) -> &'static str {
        match self {
            Error::Db(_) => "db",
            Error::Io(_) => "io",
            Error::Zip(_) => "zip",
            Error::Json(_) => "json",
            Error::NotFound(_) => "not_found",
            Error::Invalid(_) => "invalid",
            Error::BackupCorrupt(_) => "backup_corrupt",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
