use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;
use studium_core::{db, settings};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri_plugin_opener::OpenerExt;

use super::St;
use crate::state::{CmdError, CmdResult};

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub db_path: String,
    pub files_dir: String,
    pub log_dir: Option<String>,
    pub schema_version: i64,
    pub platform: String,
}

#[tauri::command]
pub async fn app_info(app: tauri::AppHandle, state: St<'_>) -> CmdResult<AppInfo> {
    use tauri::Manager;
    let schema = state.with(db::schema_version)?;
    Ok(AppInfo {
        version: super::backup::APP_VERSION.into(),
        data_dir: state.data_dir.to_string_lossy().into(),
        db_path: db::db_path(&state.data_dir).to_string_lossy().into(),
        files_dir: state.store.root().to_string_lossy().into(),
        log_dir: app.path().app_log_dir().ok().map(|p| p.to_string_lossy().into()),
        schema_version: schema,
        platform: std::env::consts::OS.into(),
    })
}

#[tauri::command]
pub async fn settings_all(state: St<'_>) -> CmdResult<serde_json::Map<String, Value>> {
    state.with(settings::all)
}

#[tauri::command]
pub async fn setting_set(state: St<'_>, key: String, value: Value) -> CmdResult<()> {
    state.with(|c| settings::set(c, &key, &value))
}

const EXPORT_EXT: &[&str] = &["docx", "md", "txt", "html"];

/// Schreibt eine exportierte Datei (Rohdaten im Request-Body, Zielpfad im
/// Header `x-path-hex`, UTF-8 als Hex). Der Pfad stammt aus dem Speichern-Dialog.
#[tauri::command]
pub async fn export_write(request: Request<'_>) -> CmdResult<()> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError::new("invalid", "Exportdaten fehlen."));
    };
    let path = request
        .headers()
        .get("x-path-hex")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| hex::decode(v).ok())
        .and_then(|v| String::from_utf8(v).ok())
        .ok_or_else(|| CmdError::new("invalid", "Zielpfad fehlt."))?;
    let path = PathBuf::from(path);
    let ext = studium_core::files::extension_of(&path);
    if !EXPORT_EXT.contains(&ext.as_str()) {
        return Err(CmdError::new("invalid", "Dieser Dateityp kann nicht exportiert werden."));
    }
    // Erst vollständig in eine Nachbardatei schreiben, dann umbenennen.
    let tmp = path.with_extension(format!("{ext}.partial"));
    std::fs::write(&tmp, bytes).map_err(|e| CmdError::new("io", format!("Die Datei konnte nicht gespeichert werden ({e}).")))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        CmdError::new("io", format!("Die Datei konnte nicht gespeichert werden ({e})."))
    })?;
    Ok(())
}

/// Liest eine vom Benutzer gewählte Datei zum Import in den Editor (DOCX, Markdown, Text).
#[tauri::command]
pub async fn read_external_file(path: String) -> CmdResult<Response> {
    let p = PathBuf::from(path);
    let ext = studium_core::files::extension_of(&p);
    if !["docx", "md", "markdown", "txt"].contains(&ext.as_str()) {
        return Err(CmdError::new("invalid", "Nur DOCX-, Markdown- und Textdateien können als Notiz importiert werden."));
    }
    let meta = std::fs::metadata(&p).map_err(|_| CmdError::new("not_found", "Die Datei wurde nicht gefunden."))?;
    if !meta.is_file() || meta.len() > 50 * 1024 * 1024 {
        return Err(CmdError::new("invalid", "Die Datei ist zu groß (über 50 MB) oder kein normales Dokument."));
    }
    let bytes = std::fs::read(&p).map_err(|e| CmdError::new("io", format!("Die Datei ist nicht lesbar ({e}).")))?;
    Ok(Response::new(bytes))
}

/// Öffnet einen Weblink im Standardbrowser – nie innerhalb der App.
#[tauri::command]
pub async fn open_url(app: tauri::AppHandle, url: String) -> CmdResult<()> {
    let ok = (url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) && url.len() < 4000;
    if !ok {
        return Err(CmdError::new("invalid", "Nur Web- und E-Mail-Links können geöffnet werden."));
    }
    app.opener().open_url(url, None::<&str>).map_err(|_| CmdError::new("open", "Der Link konnte nicht geöffnet werden."))
}

/// Zeigt den Datenordner (oder eine Backup-Datei) im Finder/Explorer.
#[tauri::command]
pub async fn reveal_path(app: tauri::AppHandle, state: St<'_>, path: Option<String>) -> CmdResult<()> {
    let p = path.map(PathBuf::from).unwrap_or_else(|| state.data_dir.clone());
    app.opener().reveal_item_in_dir(p).map_err(|_| CmdError::new("open", "Der Ordner konnte nicht angezeigt werden."))
}
