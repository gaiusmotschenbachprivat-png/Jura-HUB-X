//! Tauri-Hülle von Studium OS.

mod commands;
mod state;

use std::sync::Arc;

use tauri::Manager;

use commands::*;

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                    file_name: Some("studium-os".into()),
                }))
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout))
                .max_file_size(2_000_000)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let st = match state::AppState::open(data_dir) {
                Ok(s) => Arc::new(s),
                Err(e) => {
                    log::error!("Start fehlgeschlagen: {e}");
                    return Err(Box::new(e));
                }
            };
            backup::start_auto_backup(st.clone());
            app.manage(st);
            log::info!("Studium OS gestartet");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system::app_info,
            system::settings_all,
            system::setting_set,
            system::export_write,
            system::read_external_file,
            system::open_url,
            system::reveal_path,
            structure::areas_list,
            structure::area_create,
            structure::area_update,
            structure::area_reorder,
            structure::area_set_archived,
            structure::nodes_list,
            structure::node_get,
            structure::node_create,
            structure::node_update,
            structure::node_move,
            structure::node_set_archived,
            structure::node_trash,
            structure::node_area_ref_add,
            structure::node_area_ref_remove,
            structure::area_refs_list,
            structure::trash_list,
            structure::trash_restore,
            structure::trash_purge,
            notes::note_get,
            notes::note_save,
            notes::note_versions,
            notes::note_version_content,
            notes::note_version_restore,
            notes::note_version_create,
            notes::notes_recent,
            notes::search,
            documents::documents_import,
            documents::documents_list,
            documents::document_get,
            documents::documents_recent,
            documents::document_update,
            documents::document_set_text,
            documents::document_text_error,
            documents::document_add_placement,
            documents::document_remove_placement,
            documents::document_bytes,
            documents::document_trash,
            documents::document_open_external,
            documents::document_export_copy,
            documents::suggested_file_name,
            documents::links_for,
            documents::link_add,
            documents::link_remove,
            documents::document_page_text,
            documents::document_pages_text,
            learning::knowledge_list,
            learning::knowledge_get,
            learning::knowledge_create,
            learning::knowledge_update,
            learning::knowledge_trash,
            learning::knowledge_fields,
            learning::citation_parse,
            learning::cards_list,
            learning::card_create,
            learning::card_update,
            learning::card_review,
            learning::card_trash,
            learning::card_stats,
            learning::tasks_list,
            learning::task_create,
            learning::task_update,
            learning::task_trash,
            learning::exams_list,
            learning::exam_save,
            learning::exam_trash,
            learning::annotations_list,
            learning::annotation_create,
            learning::annotation_update,
            learning::annotation_delete,
            learning::image_store,
            learning::image_bytes,
            backup::backup_settings,
            backup::backup_create,
            backup::backup_verify,
            backup::backup_restore,
            backup::backup_history,
        ])
        .run(tauri::generate_context!())
        .expect("Studium OS konnte nicht gestartet werden");
}
