use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use studium_core::files::{sanitize_filename, unique_path};
use studium_core::repo::documents::{self, Document, Placement, Scope};
use studium_core::repo::links::{self, LinkView, NewLink};
use studium_core::repo::trash;
use tauri::ipc::Response;
use tauri_plugin_opener::OpenerExt;

use super::St;
use crate::state::{CmdError, CmdResult};

#[derive(Serialize)]
pub struct ImportOutcome {
    pub file_name: String,
    pub document: Option<Document>,
    pub error: Option<String>,
}

/// Importiert Dateien, die der Benutzer über den Dateidialog oder per
/// Drag-and-drop ausgewählt hat. Jede Datei wird einzeln behandelt, damit eine
/// fehlerhafte Datei nicht den ganzen Import abbricht.
#[tauri::command]
pub async fn documents_import(
    state: St<'_>,
    paths: Vec<String>,
    node_id: Option<String>,
    doc_type: String,
) -> CmdResult<Vec<ImportOutcome>> {
    if paths.len() > 500 {
        return Err(CmdError::new("invalid", "Bitte höchstens 500 Dateien auf einmal importieren."));
    }
    let st = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|p| {
                let path = PathBuf::from(&p);
                let file_name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(p.clone());
                match st.with(|c| documents::import(c, &st.store, &path, node_id.as_deref(), &doc_type)) {
                    Ok(d) => ImportOutcome { file_name, document: Some(d), error: None },
                    Err(e) => ImportOutcome { file_name, document: None, error: Some(e.message) },
                }
            })
            .collect()
    })
    .await
    .map_err(|_| CmdError::new("internal", "Der Import wurde unerwartet abgebrochen."))
}

#[derive(Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
pub enum ScopeArg {
    All,
    Area(String),
    Node(String),
    Subtree(String),
    Unassigned,
}

#[tauri::command]
pub async fn documents_list(state: St<'_>, scope: ScopeArg) -> CmdResult<Vec<Document>> {
    let store = state.store.clone();
    state.with(|c| {
        let s = match &scope {
            ScopeArg::All => Scope::All,
            ScopeArg::Area(a) => Scope::Area(a),
            ScopeArg::Node(n) => Scope::Node(n),
            ScopeArg::Subtree(n) => Scope::Subtree(n),
            ScopeArg::Unassigned => Scope::Unassigned,
        };
        documents::list(c, Some(&store), s)
    })
}

#[derive(Serialize)]
pub struct DocumentDetail {
    pub document: Document,
    pub placements: Vec<Placement>,
}

#[tauri::command]
pub async fn document_get(state: St<'_>, id: String) -> CmdResult<DocumentDetail> {
    let store = state.store.clone();
    state.with(|c| {
        Ok(DocumentDetail { document: documents::get(c, Some(&store), &id)?, placements: documents::placements(c, &id)? })
    })
}

#[tauri::command]
pub async fn documents_recent(state: St<'_>, area_id: Option<String>, limit: i64) -> CmdResult<Vec<Document>> {
    let store = state.store.clone();
    state.with(|c| documents::recent(c, Some(&store), area_id.as_deref(), limit))
}

#[tauri::command]
pub async fn document_update(state: St<'_>, id: String, title: String, doc_type: String) -> CmdResult<Document> {
    state.with(|c| documents::update(c, &id, &title, &doc_type))
}

#[tauri::command]
pub async fn document_set_text(state: St<'_>, id: String, pages: Vec<String>) -> CmdResult<Document> {
    state.with(|c| documents::set_text(c, &id, &pages))
}

#[tauri::command]
pub async fn document_text_error(state: St<'_>, id: String) -> CmdResult<()> {
    state.with(|c| documents::set_text_error(c, &id))
}

#[tauri::command]
pub async fn document_add_placement(state: St<'_>, id: String, node_id: String) -> CmdResult<()> {
    state.with(|c| documents::add_placement(c, &id, &node_id))
}

#[tauri::command]
pub async fn document_remove_placement(state: St<'_>, id: String, node_id: String) -> CmdResult<()> {
    state.with(|c| documents::remove_placement(c, &id, &node_id))
}

/// Liefert die Datei als Binärdaten (für die PDF-Ansicht in der App).
#[tauri::command]
pub async fn document_bytes(state: St<'_>, id: String) -> CmdResult<Response> {
    let store = state.store.clone();
    let bytes = state.with(|c| documents::read_bytes(c, &store, &id))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn document_trash(state: St<'_>, id: String) -> CmdResult<()> {
    state.with(|c| trash::trash_document(c, &id))
}

/// Öffnet eine **Kopie** des Dokuments mit dem Standardprogramm (z. B. Word).
/// Das Original im Speicher bleibt unverändert.
#[tauri::command]
pub async fn document_open_external(app: tauri::AppHandle, state: St<'_>, id: String) -> CmdResult<String> {
    let store = state.store.clone();
    let (doc, sha) = state.with(|c| Ok((documents::get(c, None, &id)?, documents::blob_sha(c, &id)?)))?;
    let dir = state.data_dir.join("tmp").join("geoeffnet");
    std::fs::create_dir_all(&dir).map_err(studium_core::Error::from)?;
    let dest = unique_path(&dir, &doc.title, &doc.ext);
    store.copy_out(&sha, &dest)?;
    app.opener()
        .open_path(dest.to_string_lossy(), None::<&str>)
        .map_err(|_| CmdError::new("open", "Für diesen Dateityp ist kein Programm installiert."))?;
    Ok(dest.to_string_lossy().into())
}

/// Speichert eine Kopie des Dokuments an einem frei gewählten Ort.
#[tauri::command]
pub async fn document_export_copy(state: St<'_>, id: String, dest: String) -> CmdResult<()> {
    let store = state.store.clone();
    let sha = state.with(|c| documents::blob_sha(c, &id))?;
    store.copy_out(&sha, &PathBuf::from(dest))?;
    Ok(())
}

#[tauri::command]
pub fn suggested_file_name(title: String, ext: String) -> String {
    format!("{}.{}", sanitize_filename(&title), ext.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect::<String>())
}

#[tauri::command]
pub async fn links_for(state: St<'_>, entity_type: String, id: String) -> CmdResult<Vec<LinkView>> {
    state.with(|c| links::for_entity(c, &entity_type, &id))
}

#[tauri::command]
pub async fn link_add(state: St<'_>, link: NewLink) -> CmdResult<String> {
    state.with(|c| links::add(c, link))
}

#[tauri::command]
pub async fn link_remove(state: St<'_>, id: String) -> CmdResult<()> {
    state.with(|c| links::remove(c, &id))
}

#[tauri::command]
pub async fn document_page_text(state: St<'_>, id: String, page: i64) -> CmdResult<Option<String>> {
    state.with(|c| documents::page_text(c, &id, page))
}

#[tauri::command]
pub async fn document_pages_text(state: St<'_>, id: String) -> CmdResult<Vec<String>> {
    state.with(|c| documents::pages_text(c, &id))
}
