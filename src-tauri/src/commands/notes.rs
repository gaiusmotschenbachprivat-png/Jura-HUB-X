use studium_core::repo::notes::{self, Note, RecentNote, SaveResult, VersionMeta};
use studium_core::search::{self, SearchHit};

use super::St;
use crate::state::CmdResult;

#[tauri::command]
pub async fn note_get(state: St<'_>, id: String) -> CmdResult<Note> {
    state.with(|c| notes::get(c, &id))
}

#[tauri::command]
pub async fn note_save(state: St<'_>, id: String, content_json: String, plain_text: String) -> CmdResult<SaveResult> {
    state.with(|c| notes::save(c, &id, &content_json, &plain_text))
}

#[tauri::command]
pub async fn note_versions(state: St<'_>, id: String) -> CmdResult<Vec<VersionMeta>> {
    state.with(|c| notes::list_versions(c, &id))
}

#[tauri::command]
pub async fn note_version_content(state: St<'_>, version_id: String) -> CmdResult<String> {
    state.with(|c| notes::get_version_content(c, &version_id))
}

#[tauri::command]
pub async fn note_version_restore(state: St<'_>, id: String, version_id: String) -> CmdResult<SaveResult> {
    state.with(|c| notes::restore_version(c, &id, &version_id))
}

#[tauri::command]
pub async fn note_version_create(state: St<'_>, id: String, reason: String) -> CmdResult<()> {
    state.with(|c| notes::create_version(c, &id, &reason))
}

#[tauri::command]
pub async fn notes_recent(state: St<'_>, area_id: Option<String>, limit: i64) -> CmdResult<Vec<RecentNote>> {
    state.with(|c| notes::recent(c, area_id.as_deref(), limit))
}

#[tauri::command]
pub async fn search(state: St<'_>, query: String, area_id: Option<String>) -> CmdResult<Vec<SearchHit>> {
    if query.len() > 500 {
        return Ok(vec![]);
    }
    state.with(|c| search::search(c, &query, area_id.as_deref(), 60))
}
