//! Tauri command layer for typed property schemas. The model + storage live in
//! `cortex_core::schema`; this is the thin IPC surface the frontend calls.

use tauri::State;

use crate::commands::vault::VaultState;
use cortex_core::error::{AppError, Result};
use cortex_core::schema::{PropertyDef, TypeSchema};

fn root(state: &State<'_, VaultState>) -> Result<std::path::PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

/// Resolve a schema by its key (a collection name or a note `type`). Returns
/// `null` when no schema is defined — never an error.
/// Fill `person` properties with the member roster so callers can render them.
fn with_members(root: &std::path::Path, schema: Option<TypeSchema>) -> Option<TypeSchema> {
    schema.map(|mut s| {
        cortex_core::members::fill_person_options(&mut s, &cortex_core::members::load(root));
        cortex_core::data::fill_relation_options(root, &mut s);
        s
    })
}

#[tauri::command]
pub fn get_schema(key: String, state: State<'_, VaultState>) -> Result<Option<TypeSchema>> {
    let root = root(&state)?;
    Ok(with_members(&root, cortex_core::schema::load(&root, &key)?))
}

/// Resolve the schema that governs a specific note, using the same key rule the
/// data views use (collection name, else frontmatter `type`).
#[tauri::command]
pub fn get_schema_for_note(
    path: String,
    note_type: Option<String>,
    state: State<'_, VaultState>,
) -> Result<Option<TypeSchema>> {
    match cortex_core::schema::schema_key(&path, note_type.as_deref()) {
        Some(key) => {
            let root = root(&state)?;
            Ok(with_members(&root, cortex_core::schema::load(&root, &key)?))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn set_schema(key: String, schema: TypeSchema, state: State<'_, VaultState>) -> Result<()> {
    cortex_core::schema::save(&root(&state)?, &key, &schema)
}

/// Insert or replace a single property in a schema (creating the schema file if
/// needed). Lets a view or the properties panel patch one property — e.g. add a
/// select option or recolor one — without round-tripping the whole schema.
#[tauri::command]
pub fn upsert_property(
    key: String,
    property: PropertyDef,
    state: State<'_, VaultState>,
) -> Result<()> {
    let root = root(&state)?;
    let mut schema = cortex_core::schema::load(&root, &key)?.unwrap_or_default();
    match schema.properties.iter_mut().find(|p| p.name == property.name) {
        Some(existing) => *existing = property,
        None => schema.properties.push(property),
    }
    cortex_core::schema::save(&root, &key, &schema)
}
