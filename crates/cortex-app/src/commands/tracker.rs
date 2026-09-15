//! Tracker view commands — thin wrappers over `cortex_core::tracker`.
//! Reading computes streaks and scores from the files; the only write is a
//! toggle, which edits one day's `done` list (creating the day's row from the
//! log collection's row template when it does not exist yet).


use crate::ctx::AppCtx;
use cortex_core::error::Result;
use cortex_core::tracker::{self, TrackerResult};

/// Run a tracker spec around `anchor` (a date; today when absent).
pub fn run_tracker(ctx: &AppCtx, spec: String, anchor: Option<String>) -> Result<TrackerResult> {
    let root = ctx.vault_path()?;
    let spec = cortex_core::members::resolve_me(&spec, &root);
    tracker::run_tracker(&root, &spec, anchor.as_deref())
}

/// Tick or untick one item on one day. `on` forces a state; absent = flip.
/// Returns the new state.
pub fn tracker_toggle(ctx: &AppCtx, log_source: String, date_field: String, done_field: String, date: String, item: String, on: Option<bool>) -> Result<bool> {
    let root = ctx.vault_path()?;
    let (path, now) = tracker::toggle(&root, &log_source, &date_field, &done_field, &date, &item, on)?;
    if let Some(db) = ctx.db.0.lock().unwrap().as_ref() {
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

/// Every tracker view in the vault — what the palette's "Log today…" offers.
pub fn list_trackers(ctx: &AppCtx) -> Result<Vec<TrackerRef>> {
    let root = ctx.vault_path()?;
    Ok(tracker::tracker_specs(&root).into_iter().map(|(collection, name, spec)| TrackerRef { collection, name, spec }).collect())
}
