use std::collections::BTreeMap;
use tauri::State;

use crate::commands::vault::{DbState, VaultState};
use crate::error::{AppError, Result};
use crate::data::{ChartResult, StructuredSpec, Table};
use crate::schema::{PropertyDef, TypeSchema};

#[derive(serde::Serialize)]
pub struct WireColumn {
    pub key: String,
    pub ty: String,
    /// Typed-property schema for this column (select options + colors), when the
    /// source's schema declares one. Lets the view render colored pills.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<PropertyDef>,
}

#[derive(serde::Serialize)]
pub struct WireRow {
    pub id: String,
    pub cells: BTreeMap<String, serde_json::Value>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireTable {
    pub name: String,
    pub columns: Vec<WireColumn>,
    /// Every field the source offers, before column projection — lets the
    /// toolbar list hidden columns and sort/filter on them.
    pub all_columns: Vec<String>,
    pub rows: Vec<WireRow>,
}

fn to_wire(table: Table, all_columns: Vec<String>, schema: Option<&TypeSchema>) -> WireTable {
    WireTable {
        name: table.name,
        all_columns,
        columns: table.columns.into_iter()
            .map(|c| {
                let schema = schema.and_then(|s| s.property(&c.key)).cloned();
                WireColumn { key: c.key, ty: c.ty.as_str().to_string(), schema }
            })
            .collect(),
        rows: table.rows.into_iter()
            .map(|r| WireRow {
                id: r.id,
                cells: r.cells.into_iter().map(|(k, v)| (k, v.to_json())).collect(),
            })
            .collect(),
    }
}

/// Resolve and run a `cortex-view` spec against the open vault, returning a
/// display-ready table (columns + rows with plain-JSON cells).
#[tauri::command]
pub fn run_view(spec: String, state: State<'_, VaultState>) -> Result<WireTable> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    let table = crate::data::run_view(&root, &spec)?;
    let parsed = crate::data::parse_view_spec(&spec).ok();
    let all_columns = parsed.as_ref()
        .and_then(|s| crate::data::source_columns(&root, &s.source).ok())
        .unwrap_or_else(|| table.columns.iter().map(|c| c.key.clone()).collect());
    // Collection sources resolve to a schema by name; CSV sources have none.
    let schema = parsed
        .and_then(|s| crate::schema::schema_key(&format!("{}/_.md", s.source.trim_end_matches('/')), None))
        .and_then(|key| crate::schema::load(&root, &key).ok().flatten());
    Ok(to_wire(table, all_columns, schema.as_ref()))
}

/// Parse a YAML view spec into the structured form the toolbar edits.
#[tauri::command]
pub fn parse_view_spec(spec: String) -> Result<StructuredSpec> {
    crate::data::parse_view_spec(&spec)
}

/// Serialize a structured spec (from the toolbar) back to canonical YAML.
#[tauri::command]
pub fn serialize_view_spec(spec: StructuredSpec) -> Result<String> {
    Ok(crate::data::serialize_view_spec(&spec))
}

/// Resolve a `cortex-chart` spec into a single `{x, y}` series.
#[tauri::command]
pub fn run_chart(spec: String, state: State<'_, VaultState>) -> Result<ChartResult> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    crate::data::run_chart(&root, &spec)
}

/// Write one edited cell back to its source (collection note frontmatter or CSV
/// line). `source` is the spec's `source:` string; `ty` is the column type.
#[tauri::command]
pub fn set_cell(
    source: String,
    row_id: String,
    field: String,
    value: String,
    ty: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    let written = crate::data::set_cell(&root, &source, &row_id, &field, &value, &ty)?;
    // Keep the index in sync when a collection note (a row) changed.
    if let Some(path) = written {
        if let Some(db) = db_state.0.lock().unwrap().as_ref() {
            let _ = crate::commands::indexer::index_file(&root, &path, db);
        }
    }
    Ok(())
}

/// Append a new row to a source. `fields` seeds initial values (title, created,
/// and e.g. a board group's value).
#[tauri::command]
pub fn add_row(
    source: String,
    id: String,
    fields: std::collections::HashMap<String, String>,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    let fields: std::collections::BTreeMap<String, String> = fields.into_iter().collect();
    let written = crate::data::add_row(&root, &source, &id, &fields)?;
    if let Some(path) = written {
        if let Some(db) = db_state.0.lock().unwrap().as_ref() {
            let _ = crate::commands::indexer::index_file(&root, &path, db);
        }
    }
    Ok(())
}

/// Delete a row. Collection rows go to the trash (recoverable); CSV rows are
/// removed from the file.
#[tauri::command]
pub fn delete_row(
    source: String,
    row_id: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    if row_id.contains('/') || row_id.contains("..") {
        return Err(AppError::Other("Invalid row id".into()));
    }
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;

    if let Some(name) = source.strip_prefix("collections/") {
        let rel = format!("collections/{}/{}.md", name.trim_end_matches('/'), row_id);
        crate::commands::trash::move_to_trash(&root, &rel)?;
        if let Some(db) = db_state.0.lock().unwrap().as_ref() {
            let _ = db.remove_note(&rel);
        }
        Ok(())
    } else {
        crate::data::delete_csv_row(&root, &source, &row_id)
    }
}
