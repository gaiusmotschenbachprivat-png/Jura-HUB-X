//! Tauri-Befehle. Dünne Adapter: Argumente annehmen, `studium-core` aufrufen,
//! Fehler verständlich zurückgeben. Keine Geschäftslogik hier.

pub mod backup;
pub mod documents;
pub mod notes;
pub mod structure;
pub mod system;

use std::sync::Arc;

use crate::state::AppState;

pub type St<'a> = tauri::State<'a, Arc<AppState>>;
