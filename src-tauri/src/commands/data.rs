use std::collections::BTreeMap;
use tauri::State;

use crate::commands::vault::{DbState, VaultState};
use cortex_core::error::{AppError, Result};
use cortex_core::data::{ChartResult, StructuredSpec, Table};
use cortex_core::schema::{PropType, PropertyDef, TypeSchema};

/// Column type label for a schema-only property (one with no row values yet).
fn prop_ty(ty: PropType) -> &'static str {
    match ty {
        PropType::Number => "number",
        PropType::Date => "date",
        PropType::Checkbox => "bool",
        PropType::MultiSelect | PropType::Relation => "list",
        _ => "text",
    }
}

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
    // `$body` is a pseudo-column (the note body) used for filters/search — never
    // shown as a table column.
    let mut columns: Vec<WireColumn> = table.columns.into_iter()
        .filter(|c| c.key != "$body")
        .map(|c| {
            let schema = schema.and_then(|s| s.property(&c.key)).cloned();
            WireColumn { key: c.key, ty: c.ty.as_str().to_string(), schema }
        })
        .collect();

    // Surface schema properties that no row has a value for yet (e.g. a property
    // the user just added), so they appear as empty columns.
    if let Some(s) = schema {
        for p in &s.properties {
            if p.name != "$body" && !columns.iter().any(|c| c.key == p.name) {
                columns.push(WireColumn { key: p.name.clone(), ty: prop_ty(p.ty).to_string(), schema: Some(p.clone()) });
            }
        }
    }

    WireTable {
        name: table.name,
        all_columns,
        columns,
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
    // Resolve `@me` (per-viewer) before querying — "assigned to me" works for all.
    let spec = cortex_core::members::resolve_me(&spec, &root);
    let mut table = cortex_core::data::run_view(&root, &spec)?;
    let parsed = cortex_core::data::parse_view_spec(&spec).ok();
    let all_columns = parsed.as_ref()
        .and_then(|s| cortex_core::data::source_columns(&root, &s.source).ok())
        .unwrap_or_else(|| table.columns.iter().map(|c| c.key.clone()).collect());
    // Collection sources resolve to a schema by name; CSV sources have none.
    // `person` options come from the roster; `relation` options from the linked
    // collection; `rollup` cells are computed per row.
    let members = cortex_core::members::load(&root);
    let schema = parsed
        .and_then(|s| cortex_core::schema::schema_key(&format!("{}/_.md", s.source.trim_end_matches('/')), None))
        .and_then(|key| cortex_core::schema::load(&root, &key).ok().flatten())
        .map(|mut s| {
            cortex_core::members::fill_person_options(&mut s, &members);
            cortex_core::data::fill_relation_options(&root, &mut s);
            s
        });
    if let Some(s) = &schema {
        cortex_core::data::apply_rollups(&root, &mut table, s);
    }
    Ok(to_wire(table, all_columns, schema.as_ref()))
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
    #[serde(skip_serializing_if = "Option::is_none", default)]
    filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    sort: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    x: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    y: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    agg: Option<String>,
    #[serde(rename = "chartType", skip_serializing_if = "Option::is_none", default)]
    chart_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    bucket: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    series: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    log: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    done: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    range: Option<String>,
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
    #[serde(default)]
    filter: Option<String>,
    #[serde(default)]
    sort: Option<Vec<String>>,
    #[serde(default)]
    columns: Option<Vec<String>>,
    #[serde(default)]
    group: Option<String>,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    x: Option<String>,
    #[serde(default)]
    y: Option<String>,
    #[serde(default)]
    agg: Option<String>,
    #[serde(rename = "chartType", default)]
    chart_type: Option<String>,
    #[serde(default)]
    bucket: Option<String>,
    #[serde(default)]
    series: Option<String>,
    #[serde(default)]
    log: Option<String>,
    #[serde(default)]
    done: Option<String>,
    #[serde(default)]
    range: Option<String>,
}

/// Parse an embedded block's spec into a multi-view document. A legacy single
/// spec becomes a one-view doc. Every view gets a display name.
#[tauri::command]
pub fn parse_view_doc(spec: String) -> Result<ViewDoc> {
    let raw: RawDoc = serde_yaml::from_str(&spec)?;
    let mut views = match raw.views {
        Some(v) if !v.is_empty() => v,
        _ => vec![ViewDocView {
            name: None,
            kind: raw.kind.unwrap_or_else(default_table),
            filter: raw.filter,
            sort: raw.sort,
            columns: raw.columns,
            group: raw.group,
            date: raw.date,
            x: raw.x,
            y: raw.y,
            agg: raw.agg,
            chart_type: raw.chart_type,
            bucket: raw.bucket,
            series: raw.series,
            log: raw.log,
            done: raw.done,
            range: raw.range,
        }],
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
    let written = cortex_core::data::set_cell(&root, &source, &row_id, &field, &value, &ty)?;
    // Keep the index in sync when a collection note (a row) changed.
    if let Some(path) = written {
        if let Some(db) = db_state.0.lock().unwrap().as_ref() {
            let _ = cortex_core::index::index_file(&root, &path, db);
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
