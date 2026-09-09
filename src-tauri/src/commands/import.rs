//! Import commands — thin wrappers over `cortex_core::import`. Each one is an
//! explicit user action from the Import dialog; the plan calls write nothing.

use tauri::State;

use cortex_core::error::{AppError, Result};
use cortex_core::import::notion::{self, NotionReport};
use cortex_core::import::{self, ColumnMap, CsvOptions, CsvPlan, CsvReport, MarkdownReport};

use super::vault::{DbState, VaultState};

fn root(state: &State<'_, VaultState>) -> Result<std::path::PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

fn options(collection: String, title_column: Option<String>, columns: Option<Vec<ColumnMap>>) -> CsvOptions {
    CsvOptions { collection, title_column, columns: columns.unwrap_or_default() }
}

/// The column mapping and the first rows a CSV import would write.
#[tauri::command]
pub fn import_csv_plan(
    path: String,
    collection: String,
    title_column: Option<String>,
    columns: Option<Vec<ColumnMap>>,
    state: State<'_, VaultState>,
) -> Result<CsvPlan> {
    import::plan_csv(&root(&state)?, std::path::Path::new(&path), &options(collection, title_column, columns))
}

/// Write the rows (and schema, and `_index.md` for a new collection), then index them.
#[tauri::command]
pub fn import_csv(
    path: String,
    collection: String,
    title_column: Option<String>,
    columns: Option<Vec<ColumnMap>>,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<CsvReport> {
    let root = root(&state)?;
    let r = import::import_csv(&root, std::path::Path::new(&path), &options(collection, title_column, columns))?;
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        for p in &r.written {
            let _ = cortex_core::index::index_file(&root, &root.join(p), db);
        }
    }
    Ok(r)
}

/// Copy a folder of Markdown under `notes/<into>/`; `dry_run` only reports.
#[tauri::command]
pub fn import_markdown(
    path: String,
    into: String,
    dry_run: bool,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<MarkdownReport> {
    let root = root(&state)?;
    let r = import::import_markdown(&root, std::path::Path::new(&path), &into, dry_run)?;
    if !dry_run {
        if let Some(db) = db_state.0.lock().unwrap().as_ref() {
            for p in &r.notes {
                let _ = cortex_core::index::index_file(&root, &root.join(p), db);
            }
        }
    }
    Ok(r)
}

/// Import a Notion export zip (or its unpacked folder); `dry_run` only reports.
#[tauri::command]
pub fn import_notion(
    path: String,
    into: String,
    dry_run: bool,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<NotionReport> {
    let root = root(&state)?;
    let r = notion::import_notion(&root, std::path::Path::new(&path), &into, dry_run)?;
    if !dry_run {
        if let Some(db) = db_state.0.lock().unwrap().as_ref() {
            let rows = r.collections.iter().flat_map(|c| c.written.iter());
            for p in r.notes.iter().chain(rows).chain(r.report.iter()) {
                let _ = cortex_core::index::index_file(&root, &root.join(p), db);
            }
        }
    }
    Ok(r)
}
