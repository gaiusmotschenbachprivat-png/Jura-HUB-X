//! Befehle für Wissensobjekte, Karteikarten, Planung, PDF-Markierungen und Bilder.

use studium_core::repo::annotations::{self, Annotation, AnnotationPatch, NewAnnotation};
use studium_core::repo::cards::{self, Card, CardFilter, CardPatch, CardStats, NewCard, ReviewInput};
use studium_core::repo::documents;
use studium_core::repo::knowledge::{self, CitationData, Knowledge, KnowledgeFilter, KnowledgePatch, NewKnowledge};
use studium_core::repo::planning::{self, Exam, ExamInput, NewTask, Task, TaskFilter, TaskPatch};
use tauri::ipc::{InvokeBody, Request, Response};

use super::St;
use crate::state::{CmdError, CmdResult};

// ---- Wissensobjekte ----

#[tauri::command]
pub async fn knowledge_list(state: St<'_>, filter: KnowledgeFilter) -> CmdResult<Vec<Knowledge>> {
    state.with(|c| knowledge::list(c, &filter))
}

#[tauri::command]
pub async fn knowledge_get(state: St<'_>, id: String) -> CmdResult<Knowledge> {
    state.with(|c| knowledge::get(c, &id))
}

#[tauri::command]
pub async fn knowledge_create(state: St<'_>, input: NewKnowledge) -> CmdResult<Knowledge> {
    state.with(|c| knowledge::create(c, input))
}

#[tauri::command]
pub async fn knowledge_update(state: St<'_>, id: String, patch: KnowledgePatch) -> CmdResult<Knowledge> {
    state.with(|c| knowledge::update(c, &id, patch))
}

#[tauri::command]
pub async fn knowledge_trash(state: St<'_>, id: String) -> CmdResult<()> {
    state.with(|c| knowledge::trash(c, &id))
}

#[tauri::command]
pub async fn knowledge_fields(state: St<'_>) -> CmdResult<Vec<String>> {
    state.with(knowledge::fields)
}

#[tauri::command]
pub fn citation_parse(text: String) -> Option<CitationData> {
    knowledge::parse_citation(&text)
}

// ---- Karteikarten ----

#[tauri::command]
pub async fn cards_list(state: St<'_>, filter: CardFilter) -> CmdResult<Vec<Card>> {
    state.with(|c| cards::list(c, &filter))
}

#[tauri::command]
pub async fn card_create(state: St<'_>, input: NewCard) -> CmdResult<Card> {
    state.with(|c| cards::create(c, input))
}

#[tauri::command]
pub async fn card_update(state: St<'_>, id: String, patch: CardPatch) -> CmdResult<Card> {
    state.with(|c| cards::update(c, &id, patch))
}

#[tauri::command]
pub async fn card_review(state: St<'_>, id: String, review: ReviewInput) -> CmdResult<Card> {
    state.with(|c| cards::review(c, &id, review))
}

#[tauri::command]
pub async fn card_trash(state: St<'_>, id: String) -> CmdResult<()> {
    state.with(|c| cards::trash(c, &id))
}

#[tauri::command]
pub async fn card_stats(state: St<'_>, area_id: Option<String>, day_start: String) -> CmdResult<CardStats> {
    state.with(|c| cards::stats(c, area_id.as_deref(), &day_start))
}

// ---- Aufgaben und Prüfungen ----

#[tauri::command]
pub async fn tasks_list(state: St<'_>, filter: TaskFilter) -> CmdResult<Vec<Task>> {
    state.with(|c| planning::task_list(c, &filter))
}

#[tauri::command]
pub async fn task_create(state: St<'_>, input: NewTask) -> CmdResult<Task> {
    state.with(|c| planning::task_create(c, input))
}

#[tauri::command]
pub async fn task_update(state: St<'_>, id: String, patch: TaskPatch) -> CmdResult<Task> {
    state.with(|c| planning::task_update(c, &id, patch))
}

#[tauri::command]
pub async fn task_trash(state: St<'_>, id: String) -> CmdResult<()> {
    state.with(|c| planning::trash(c, "task", &id))
}

#[tauri::command]
pub async fn exams_list(state: St<'_>, area_id: Option<String>, from: Option<String>) -> CmdResult<Vec<Exam>> {
    state.with(|c| planning::exam_list(c, area_id.as_deref(), from.as_deref()))
}

#[tauri::command]
pub async fn exam_save(state: St<'_>, id: Option<String>, input: ExamInput) -> CmdResult<Exam> {
    state.with(|c| planning::exam_save(c, id.as_deref(), input))
}

#[tauri::command]
pub async fn exam_trash(state: St<'_>, id: String) -> CmdResult<()> {
    state.with(|c| planning::trash(c, "exam", &id))
}

// ---- PDF-Markierungen ----

#[tauri::command]
pub async fn annotations_list(state: St<'_>, document_id: String) -> CmdResult<Vec<Annotation>> {
    state.with(|c| annotations::list(c, &document_id))
}

#[tauri::command]
pub async fn annotation_create(state: St<'_>, input: NewAnnotation) -> CmdResult<Annotation> {
    state.with(|c| annotations::create(c, input))
}

#[tauri::command]
pub async fn annotation_update(state: St<'_>, id: String, patch: AnnotationPatch) -> CmdResult<Annotation> {
    state.with(|c| annotations::update(c, &id, patch))
}

#[tauri::command]
pub async fn annotation_delete(state: St<'_>, id: String) -> CmdResult<()> {
    state.with(|c| annotations::delete(c, &id))
}

// ---- Bilder in Notizen ----

/// Speichert ein Bild (Rohdaten im Request-Body) und liefert seine Kennung.
#[tauri::command]
pub async fn image_store(state: St<'_>, request: Request<'_>) -> CmdResult<String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError::new("invalid", "Bilddaten fehlen."));
    };
    let store = state.store.clone();
    state.with(|c| documents::store_image(c, &store, bytes))
}

#[tauri::command]
pub async fn image_bytes(state: St<'_>, sha: String) -> CmdResult<Response> {
    let store = state.store.clone();
    let (bytes, _mime) = state.with(|c| documents::image_bytes(c, &store, &sha))?;
    Ok(Response::new(bytes))
}
