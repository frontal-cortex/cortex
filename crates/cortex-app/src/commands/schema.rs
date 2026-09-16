//! Tauri command layer for typed property schemas. The model + storage live in
//! `cortex_core::schema`; this is the thin IPC surface the frontend calls.


use crate::ctx::AppCtx;
use cortex_core::error::Result;
use cortex_core::schema::{PropertyChange, PropertyDef, TypeSchema};

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
pub fn get_schema(ctx: &AppCtx, key: String) -> Result<Option<TypeSchema>> {
    let root = ctx.vault_path()?;
    Ok(with_members(&root, cortex_core::schema::load(&root, &key)?))
}

/// Resolve the schema that governs a specific note, using the same key rule the
/// data views use (collection name, else frontmatter `type`).
pub fn get_schema_for_note(ctx: &AppCtx, path: String, note_type: Option<String>) -> Result<Option<TypeSchema>> {
    match cortex_core::schema::schema_key(&path, note_type.as_deref()) {
        Some(key) => {
            let root = ctx.vault_path()?;
            Ok(with_members(&root, cortex_core::schema::load(&root, &key)?))
        }
        None => Ok(None),
    }
}
pub fn set_schema(ctx: &AppCtx, key: String, schema: TypeSchema) -> Result<()> {
    cortex_core::schema::save(&ctx.vault_path()?, &key, &schema)
}

/// Insert or replace a single property in a schema (creating the schema file if
/// needed). Lets a view or the properties panel patch one property — e.g. add a
/// select option or recolor one — without round-tripping the whole schema.
pub fn upsert_property(ctx: &AppCtx, key: String, property: PropertyDef) -> Result<()> {
    let root = ctx.vault_path()?;
    let mut schema = cortex_core::schema::load(&root, &key)?.unwrap_or_default();
    match schema.properties.iter_mut().find(|p| p.name == property.name) {
        Some(existing) => *existing = property,
        None => schema.properties.push(property),
    }
    cortex_core::schema::save(&root, &key, &schema)
}

/// Re-index the notes a schema edit rewrote (rows, the collection's `_index.md`).
fn reindex(ctx: &AppCtx, root: &std::path::Path, change: &PropertyChange) {
    if let Some(db) = ctx.db.0.lock().unwrap().as_ref() {
        for rel in &change.files {
            let _ = cortex_core::index::index_file(root, &root.join(rel), db);
        }
    }
}

/// Rename a property everywhere: the schema, every row's frontmatter key, the
/// collection's views, and the rollups / formulas that reference it.
pub fn rename_property(ctx: &AppCtx, key: String, old: String, new: String) -> Result<PropertyChange> {
    let root = ctx.vault_path()?;
    let change = cortex_core::schema::rename_property(&root, &key, &old, &new)?;
    reindex(ctx, &root, &change);
    Ok(change)
}

/// Delete a property from the schema, every row and every view. Refused while
/// a rollup or formula still depends on it (the error names them).
pub fn delete_property(ctx: &AppCtx, key: String, name: String) -> Result<PropertyChange> {
    let root = ctx.vault_path()?;
    let change = cortex_core::schema::delete_property(&root, &key, &name)?;
    reindex(ctx, &root, &change);
    Ok(change)
}
