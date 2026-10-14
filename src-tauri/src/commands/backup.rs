use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use studium_core::backup::{self, BackupInfo, BackupOptions, BackupRecord, RestoreResult, VerifyReport};
use studium_core::{search, settings};

use super::St;
use crate::state::{AppState, CmdError, CmdResult};

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Serialize, Clone)]
pub struct BackupSettings {
    pub dir: String,
    pub second_dir: Option<String>,
    pub auto_enabled: bool,
    pub keep: u32,
    pub last_auto: Option<String>,
}

pub fn read_settings(st: &AppState) -> CmdResult<BackupSettings> {
    st.with(|c| {
        let s = |k: &str| settings::get(c, k);
        Ok(BackupSettings {
            dir: s("backup.dir")?
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| st.default_backup_dir().to_string_lossy().into()),
            second_dir: s("backup.second_dir")?.and_then(|v| v.as_str().map(String::from)).filter(|v| !v.is_empty()),
            auto_enabled: s("backup.auto_enabled")?.and_then(|v| v.as_bool()).unwrap_or(false),
            keep: s("backup.keep")?.and_then(|v| v.as_u64()).map(|v| v.clamp(1, 365) as u32).unwrap_or(14),
            last_auto: s("backup.last_auto")?.and_then(|v| v.as_str().map(String::from)),
        })
    })
}

/// Erstellt ein Backup und vermerkt Erfolg oder Fehler in der Datenbank.
pub fn run_backup(st: &AppState, kind: &str) -> CmdResult<BackupInfo> {
    let cfg = read_settings(st)?;
    let second = cfg.second_dir.as_ref().map(PathBuf::from);
    let res = backup::create(
        &st.data_dir,
        Path::new(&cfg.dir),
        &BackupOptions { kind, app_version: APP_VERSION, second_dir: second.as_deref() },
    );
    match res {
        Ok(info) => {
            let msg = info.second_copy_error.clone();
            st.with(|c| backup::record(c, &info, if msg.is_some() { "warnung" } else { "ok" }, msg.as_deref()))?;
            if kind == "auto" {
                let _ = backup::prune_auto(Path::new(&cfg.dir), cfg.keep as usize);
                if let Some(s) = &second {
                    let _ = backup::prune_auto(s, cfg.keep as usize);
                }
            }
            log::info!("Backup erstellt ({kind})");
            Ok(info)
        }
        Err(e) => {
            log::error!("Backup fehlgeschlagen ({kind}): {e}");
            let failed = BackupInfo {
                path: cfg.dir.clone(),
                size: 0,
                sha256: String::new(),
                created_at: studium_core::util::now(),
                file_count: 0,
                kind: kind.into(),
                second_copy: None,
                second_copy_error: None,
            };
            let msg = e.to_string();
            let _ = st.with(|c| backup::record(c, &failed, "fehler", Some(&msg)));
            Err(e.into())
        }
    }
}

#[tauri::command]
pub async fn backup_settings(state: St<'_>) -> CmdResult<BackupSettings> {
    read_settings(&state)
}

#[tauri::command]
pub async fn backup_create(state: St<'_>) -> CmdResult<BackupInfo> {
    let st: Arc<AppState> = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_backup(&st, "manual"))
        .await
        .map_err(|_| CmdError::new("internal", "Das Backup wurde unerwartet abgebrochen."))?
}

#[tauri::command]
pub async fn backup_verify(path: String) -> CmdResult<VerifyReport> {
    tauri::async_runtime::spawn_blocking(move || backup::verify(Path::new(&path)).map_err(CmdError::from))
        .await
        .map_err(|_| CmdError::new("internal", "Die Prüfung wurde unerwartet abgebrochen."))?
}

#[tauri::command]
pub async fn backup_restore(state: St<'_>, path: String) -> CmdResult<RestoreResult> {
    let st: Arc<AppState> = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let res = st.with_closed(|| backup::restore(Path::new(&path), &st.data_dir))?;
        // Suchindex sicherheitshalber neu aufbauen.
        st.with(search::rebuild)?;
        log::info!("Backup wiederhergestellt");
        Ok(res)
    })
    .await
    .map_err(|_| CmdError::new("internal", "Die Wiederherstellung wurde unerwartet abgebrochen."))?
}

#[tauri::command]
pub async fn backup_history(state: St<'_>) -> CmdResult<Vec<BackupRecord>> {
    state.with(|c| backup::history(c, 30))
}

/// Prüft stündlich, ob ein automatisches Backup fällig ist (alle 24 Stunden).
pub fn start_auto_backup(st: Arc<AppState>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(90));
        if let Ok(cfg) = read_settings(&st) {
            let due = cfg.auto_enabled
                && cfg.last_auto.as_deref().is_none_or(|t| {
                    let age = time_since(t);
                    age >= 24 * 3600
                });
            if due {
                let ok = run_backup(&st, "auto").is_ok();
                let ts = studium_core::util::now();
                // Auch bei Fehlern erst in einer Stunde erneut versuchen.
                let next = if ok { ts } else { shift_back_hours(&ts, 23) };
                let _ = st.with(|c| settings::set(c, "backup.last_auto", &serde_json::Value::String(next)));
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(3600 - 90));
    });
}

fn time_since(ts: &str) -> i64 {
    let then = studium_core::util::parse_ts(ts);
    (studium_core::util::parse_ts(&studium_core::util::now()) - then).whole_seconds()
}

fn shift_back_hours(ts: &str, h: i64) -> String {
    use time::format_description::well_known::Rfc3339;
    let t = studium_core::util::parse_ts(ts) - time::Duration::hours(h);
    t.format(&Rfc3339).unwrap_or_else(|_| ts.to_string())
}
