//! Tauri command layer for typed property schemas. The model + storage live in
//! `crate::schema`; this is the thin IPC surface the frontend calls.

use tauri::State;

use crate::commands::vault::VaultState;
use crate::error::{AppError, Result};
use crate::schema::{PropertyDef, TypeSchema};

fn root(state: &State<'_, VaultState>) -> Result<std::path::PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

/// Resolve a schema by its key (a collection name or a note `type`). Returns
/// `null` when no schema is defined — never an error.
/// Fill `person` properties with the member roster so callers can render them.
fn with_members(root: &std::path::Path, schema: Option<TypeSchema>) -> Option<TypeSchema> {
    schema.map(|mut s| {
        crate::members::fill_person_options(&mut s, &crate::members::load(root));
        s
    })
}

#[tauri::command]
pub fn get_schema(key: String, state: State<'_, VaultState>) -> Result<Option<TypeSchema>> {
    let root = root(&state)?;
    Ok(with_members(&root, crate::schema::load(&root, &key)?))
}

/// Resolve the schema that governs a specific note, using the same key rule the
/// data views use (collection name, else frontmatter `type`).
#[tauri::command]
pub fn get_schema_for_note(
    path: String,
    note_type: Option<String>,
    state: State<'_, VaultState>,
) -> Result<Option<TypeSchema>> {
    match crate::schema::schema_key(&path, note_type.as_deref()) {
        Some(key) => {
            let root = root(&state)?;
            Ok(with_members(&root, crate::schema::load(&root, &key)?))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn set_schema(key: String, schema: TypeSchema, state: State<'_, VaultState>) -> Result<()> {
    crate::schema::save(&root(&state)?, &key, &schema)
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
    let mut schema = crate::schema::load(&root, &key)?.unwrap_or_default();
    match schema.properties.iter_mut().find(|p| p.name == property.name) {
        Some(existing) => *existing = property,
        None => schema.properties.push(property),
    }
    crate::schema::save(&root, &key, &schema)
}
