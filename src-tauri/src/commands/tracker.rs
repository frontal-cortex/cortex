//! Tracker view commands — thin wrappers over `cortex_core::tracker`.
//! Reading computes streaks and scores from the files; the only write is a
//! toggle, which edits one day's `done` list (creating the day's row from the
//! log collection's row template when it does not exist yet).

use tauri::State;

use crate::commands::vault::{DbState, VaultState};
use cortex_core::error::{AppError, Result};
use cortex_core::tracker::{self, TrackerResult};

fn root(state: &State<'_, VaultState>) -> Result<std::path::PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

/// Run a tracker spec around `anchor` (a date; today when absent).
#[tauri::command]
pub fn run_tracker(spec: String, anchor: Option<String>, state: State<'_, VaultState>) -> Result<TrackerResult> {
    let root = root(&state)?;
    let spec = cortex_core::members::resolve_me(&spec, &root);
    tracker::run_tracker(&root, &spec, anchor.as_deref())
}

/// Tick or untick one item on one day. `on` forces a state; absent = flip.
/// Returns the new state.
#[tauri::command]
pub fn tracker_toggle(
    log_source: String,
    date_field: String,
    done_field: String,
    date: String,
    item: String,
    on: Option<bool>,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<bool> {
    let root = root(&state)?;
    let (path, now) = tracker::toggle(&root, &log_source, &date_field, &done_field, &date, &item, on)?;
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = cortex_core::index::index_file(&root, &path, db);
    }
    Ok(now)
}

#[derive(serde::Serialize)]
pub struct TrackerRef {
    pub collection: String,
    pub name: String,
    pub spec: String,
}

/// Every tracker view in the vault — what the palette's "Log habit…" offers.
#[tauri::command]
pub fn list_trackers(state: State<'_, VaultState>) -> Result<Vec<TrackerRef>> {
    let root = root(&state)?;
    Ok(tracker::tracker_specs(&root).into_iter().map(|(collection, name, spec)| TrackerRef { collection, name, spec }).collect())
}
