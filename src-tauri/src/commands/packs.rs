//! Template marketplace commands — thin wrappers over `cortex_core::marketplace`.
//! Every one is an explicit user action from the Marketplace page; nothing
//! fetches or installs on its own. The remote index is cached under the
//! app's cache directory and refreshed only when the page asks.

use tauri::{AppHandle, Manager, State};

use cortex_core::error::{AppError, Result};
use cortex_core::marketplace::{self as mk, Catalog, InstallReport, Pack, PackPreview, Plan, RemoveReport, UpdateReport};

use super::vault::VaultState;

fn root(state: &State<'_, VaultState>) -> Result<std::path::PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

fn cache_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_cache_dir().ok().map(|d| d.join("marketplace"))
}

/// Everything the user can browse. `refresh` re-fetches the remote index.
#[tauri::command]
pub fn packs_catalog(refresh: bool, app: AppHandle, state: State<'_, VaultState>) -> Result<Catalog> {
    Ok(mk::catalog(&root(&state)?, cache_dir(&app).as_deref(), refresh, true))
}

/// A pack's manifest, file list, and the plan for installing it here.
#[tauri::command]
pub fn packs_show(id: String, force: bool, app: AppHandle, state: State<'_, VaultState>) -> Result<(Pack, Plan)> {
    let root = root(&state)?;
    let pack = mk::resolve(&root, cache_dir(&app).as_deref(), &id, true)?;
    let plan = mk::plan(&root, &pack, force);
    Ok((pack, plan))
}

#[tauri::command]
pub fn packs_install(id: String, force: bool, app: AppHandle, state: State<'_, VaultState>) -> Result<Vec<InstallReport>> {
    let root = root(&state)?;
    let cache = cache_dir(&app);
    let pack = mk::resolve(&root, cache.as_deref(), &id, true)?;
    let r2 = root.clone();
    mk::install(&root, &pack, force, &move |inner| mk::resolve(&r2, cache.as_deref(), inner, true).ok())
}

#[tauri::command]
pub fn packs_update(id: String, app: AppHandle, state: State<'_, VaultState>) -> Result<UpdateReport> {
    let root = root(&state)?;
    let pack = mk::resolve(&root, cache_dir(&app).as_deref(), &id, true)?;
    mk::update(&root, &pack)
}

#[tauri::command]
pub fn packs_remove(id: String, state: State<'_, VaultState>) -> Result<RemoveReport> {
    mk::remove(&root(&state)?, &id)
}

/// What the pack's page shows: each collection's properties, views, row
/// template and seed count, the note templates, a bundle's parts — parsed
/// in core, so the page never reads YAML itself.
#[tauri::command]
pub fn packs_preview(id: String, app: AppHandle, state: State<'_, VaultState>) -> Result<PackPreview> {
    let root = root(&state)?;
    let pack = mk::resolve(&root, cache_dir(&app).as_deref(), &id, true)?;
    Ok(mk::preview(&pack))
}

/// Start a pack directory from a template or collection in this vault.
#[tauri::command]
pub fn packs_export(id: String, from: String, out_dir: String, state: State<'_, VaultState>) -> Result<String> {
    Ok(mk::export(&root(&state)?, &id, &from, std::path::Path::new(&out_dir))?.to_string_lossy().into_owned())
}
