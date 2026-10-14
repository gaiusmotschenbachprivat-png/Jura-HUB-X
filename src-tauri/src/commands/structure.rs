use serde::Serialize;
use studium_core::repo::areas::{self, Area};
use studium_core::repo::nodes::{self, NewNode, Node, NodePatch};
use studium_core::repo::trash::{self, TrashItem};

use super::St;
use crate::state::CmdResult;

#[tauri::command]
pub async fn areas_list(state: St<'_>) -> CmdResult<Vec<Area>> {
    state.with(areas::list)
}

#[tauri::command]
pub async fn area_create(state: St<'_>, name: String, color: String) -> CmdResult<Area> {
    state.with(|c| areas::create(c, &name, &color))
}

#[tauri::command]
pub async fn area_update(state: St<'_>, id: String, name: String, color: String) -> CmdResult<Area> {
    state.with(|c| areas::update(c, &id, &name, &color))
}

#[tauri::command]
pub async fn area_reorder(state: St<'_>, ids: Vec<String>) -> CmdResult<()> {
    state.with(|c| areas::reorder(c, &ids))
}

#[tauri::command]
pub async fn area_set_archived(state: St<'_>, id: String, archived: bool) -> CmdResult<Area> {
    state.with(|c| areas::set_archived(c, &id, archived))
}

#[tauri::command]
pub async fn nodes_list(state: St<'_>, area_id: Option<String>) -> CmdResult<Vec<Node>> {
    state.with(|c| nodes::list(c, area_id.as_deref()))
}

#[derive(Serialize)]
pub struct NodeDetail {
    pub node: Node,
    pub path: String,
    pub also_in_areas: Vec<String>,
}

#[tauri::command]
pub async fn node_get(state: St<'_>, id: String) -> CmdResult<NodeDetail> {
    state.with(|c| {
        studium_core::util::require_id(&id)?;
        Ok(NodeDetail {
            node: nodes::get(c, &id)?,
            path: nodes::breadcrumb(c, &id, false)?,
            also_in_areas: nodes::area_refs_of(c, &id)?,
        })
    })
}

#[tauri::command]
pub async fn node_create(state: St<'_>, input: NewNode) -> CmdResult<Node> {
    state.with(|c| nodes::create(c, input))
}

#[tauri::command]
pub async fn node_update(state: St<'_>, id: String, patch: NodePatch) -> CmdResult<Node> {
    state.with(|c| nodes::update(c, &id, patch))
}

#[tauri::command]
pub async fn node_move(
    state: St<'_>,
    id: String,
    parent_id: Option<String>,
    position: f64,
    area_id: Option<String>,
) -> CmdResult<Node> {
    state.with(|c| nodes::move_node(c, &id, parent_id.as_deref(), position, area_id.as_deref()))
}

#[tauri::command]
pub async fn node_set_archived(state: St<'_>, id: String, archived: bool) -> CmdResult<Node> {
    state.with(|c| nodes::set_archived(c, &id, archived))
}

#[tauri::command]
pub async fn node_trash(state: St<'_>, id: String) -> CmdResult<()> {
    state.with(|c| trash::trash_node(c, &id))
}

#[tauri::command]
pub async fn node_area_ref_add(state: St<'_>, node_id: String, area_id: String) -> CmdResult<()> {
    state.with(|c| nodes::add_area_ref(c, &node_id, &area_id))
}

#[tauri::command]
pub async fn node_area_ref_remove(state: St<'_>, node_id: String, area_id: String) -> CmdResult<()> {
    state.with(|c| nodes::remove_area_ref(c, &node_id, &area_id))
}

#[tauri::command]
pub async fn area_refs_list(state: St<'_>, area_id: String) -> CmdResult<Vec<Node>> {
    state.with(|c| nodes::list_area_refs(c, &area_id))
}

#[tauri::command]
pub async fn trash_list(state: St<'_>) -> CmdResult<Vec<TrashItem>> {
    state.with(trash::list)
}

#[tauri::command]
pub async fn trash_restore(state: St<'_>, item_type: String, id: String) -> CmdResult<()> {
    state.with(|c| trash::restore_any(c, &item_type, &id))
}

#[tauri::command]
pub async fn trash_purge(state: St<'_>, item_type: String, id: String) -> CmdResult<()> {
    let store = state.store.clone();
    state.with(|c| trash::purge_any(c, &store, &item_type, &id))
}
