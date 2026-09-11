use tauri::State;

use crate::commands::vault::{DbState, VaultState};
use cortex_core::error::{AppError, Result};
use cortex_core::data::{ChartResult, ResolvedTable, StatsResult, StructuredSpec};

/// Resolve and run a `cortex-view` spec against the open vault, returning a
/// display-ready table. The work lives in `cortex_core::data::resolve_view`,
/// shared with the CLI and MCP.
#[tauri::command]
pub fn run_view(spec: String, state: State<'_, VaultState>) -> Result<ResolvedTable> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    cortex_core::data::resolve_view(&root, &spec)
}

/// Collection (database) names in the vault — for relation target pickers.
#[tauri::command]
pub fn list_collections(state: State<'_, VaultState>) -> Result<Vec<String>> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root.join("collections")) {
        for e in entries.flatten() {
            if e.path().is_dir() {
                if let Some(n) = e.file_name().to_str() {
                    out.push(n.to_string());
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Parse a YAML view spec into the structured form the toolbar edits.
#[tauri::command]
pub fn parse_view_spec(spec: String) -> Result<StructuredSpec> {
    cortex_core::data::parse_view_spec(&spec)
}

// ── Multi-view document (an embedded block holding several named views) ────────

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct ViewDocView {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    name: Option<String>,
    #[serde(rename = "type", default = "default_table")]
    kind: String,
    /// Filter, sort, columns, group, date, chart and tracker options — whatever
    /// the view type reads. Carried as written; nothing here is interpreted.
    #[serde(flatten)]
    rest: serde_yaml::Mapping,
}

fn default_table() -> String { "table".into() }

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ViewDoc {
    source: String,
    views: Vec<ViewDocView>,
}

/// Legacy single-view spec (no `views:` list) — its top-level fields ARE the one
/// view. Parsing tolerates either shape.
#[derive(serde::Deserialize)]
struct RawDoc {
    source: String,
    #[serde(default)]
    views: Option<Vec<ViewDocView>>,
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(flatten)]
    rest: serde_yaml::Mapping,
}

/// Parse an embedded block's spec into a multi-view document. A legacy single
/// spec becomes a one-view doc. Every view gets a display name.
#[tauri::command]
pub fn parse_view_doc(spec: String) -> Result<ViewDoc> {
    let raw: RawDoc = serde_yaml::from_str(&spec)?;
    let mut views = match raw.views {
        Some(v) if !v.is_empty() => v,
        _ => vec![ViewDocView { name: None, kind: raw.kind.unwrap_or_else(default_table), rest: raw.rest }],
    };
    for v in &mut views {
        if v.name.is_none() {
            let mut c = v.kind.chars();
            v.name = Some(c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_else(default_table));
        }
    }
    Ok(ViewDoc { source: raw.source, views })
}

/// Serialize a multi-view document back to the block's YAML spec.
#[tauri::command]
pub fn serialize_view_doc(doc: ViewDoc) -> Result<String> {
    Ok(serde_yaml::to_string(&doc)?)
}

/// Serialize a structured spec (from the toolbar) back to canonical YAML.
#[tauri::command]
pub fn serialize_view_spec(spec: StructuredSpec) -> Result<String> {
    Ok(cortex_core::data::serialize_view_spec(&spec))
}

/// Resolve a `cortex-chart` spec into a single `{x, y}` series.
#[tauri::command]
pub fn run_chart(spec: String, state: State<'_, VaultState>) -> Result<ChartResult> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    let spec = cortex_core::members::resolve_me(&spec, &root);
    cortex_core::data::run_chart(&root, &spec)
}

/// Run a `stats` view: one tile per `stats:` entry. Nothing is written.
#[tauri::command]
pub fn run_stats(spec: String, state: State<'_, VaultState>) -> Result<StatsResult> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    cortex_core::data::run_stats(&root, &spec)
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
    let written = cortex_core::data::set_cell_effects(&root, &source, &row_id, &field, &value, &ty)?;
    // Keep the index in sync: the row, and any next occurrence a repeat created.
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        for path in &written {
            let _ = cortex_core::index::index_file(&root, path, db);
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
    let written = cortex_core::data::add_row(&root, &source, &id, &fields)?;
    if let Some(path) = written {
        if let Some(db) = db_state.0.lock().unwrap().as_ref() {
            let _ = cortex_core::index::index_file(&root, &path, db);
        }
    }
    Ok(())
}

/// Generate an export and write it to an absolute path (chosen via a save
/// dialog). `kind` = "note-html" | "collection-csv" | "collection-html".
#[tauri::command]
pub fn export_to_file(
    kind: String,
    target: String,
    dest: String,
    state: State<'_, VaultState>,
) -> Result<()> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    let content = match kind.as_str() {
        "note-html" => cortex_core::data::export_note_html(&root, &target)?,
        "collection-csv" => cortex_core::data::export_collection_csv(&root, &target)?,
        "collection-html" => cortex_core::data::export_collection_html(&root, &target)?,
        other => return Err(AppError::Other(format!("Unknown export kind: {other}"))),
    };
    std::fs::write(&dest, content)?;
    Ok(())
}

/// The path of row `id` in a collection, creating it from the collection's
/// default row template (or blank) when it does not exist yet — how Today
/// opens a journal that is a collection, and how a tracker's day comes to be.
#[tauri::command]
pub fn ensure_row(
    source: String,
    id: String,
    fields: std::collections::HashMap<String, String>,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<String> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    let fields: std::collections::BTreeMap<String, String> = fields.into_iter().collect();
    let path = cortex_core::data::ensure_row(&root, &source, &id, &fields)?;
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = cortex_core::index::index_file(&root, &path, db);
    }
    Ok(path.strip_prefix(&root).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_else(|_| path.to_string_lossy().into_owned()))
}

/// Template names available for a collection.
#[tauri::command]
pub fn list_row_templates(source: String, state: State<'_, VaultState>) -> Result<Vec<String>> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    cortex_core::data::list_row_templates(&root, &source)
}

/// Create a row from a template (its frontmatter + body, with seed fields applied).
#[tauri::command]
pub fn add_row_from_template(
    source: String,
    id: String,
    template: String,
    fields: std::collections::HashMap<String, String>,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    let fields: std::collections::BTreeMap<String, String> = fields.into_iter().collect();
    let written = cortex_core::data::add_row_from_template(&root, &source, &id, &template, &fields)?;
    if let Some(path) = written {
        if let Some(db) = db_state.0.lock().unwrap().as_ref() {
            let _ = cortex_core::index::index_file(&root, &path, db);
        }
    }
    Ok(())
}

/// Save an existing row as a reusable template.
#[tauri::command]
pub fn save_row_as_template(
    source: String,
    row_id: String,
    name: String,
    state: State<'_, VaultState>,
) -> Result<()> {
    if row_id.contains('/') || row_id.contains("..") {
        return Err(AppError::Other("Invalid row id".into()));
    }
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    cortex_core::data::save_row_as_template(&root, &source, &row_id, &name)
}

/// Duplicate a row under a new id (frontmatter + body copied, `created` set
/// to the given day, the title marked "copy").
#[tauri::command]
pub fn duplicate_row(
    source: String,
    row_id: String,
    new_id: String,
    created: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    let written = cortex_core::data::duplicate_row(&root, &source, &row_id, &new_id, &created)?;
    if let Some(path) = written {
        if let Some(db) = db_state.0.lock().unwrap().as_ref() {
            let _ = cortex_core::index::index_file(&root, &path, db);
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
        cortex_core::data::delete_csv_row(&root, &source, &row_id)
    }
}
