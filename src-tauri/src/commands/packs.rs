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

/// Every marketplace operation reads a dozen files, hashes them, and may fetch
/// a pack over the network. A synchronous command runs on the main thread and
/// freezes the window for that long; these run on the blocking pool instead.
async fn off_thread<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| AppError::Other(format!("marketplace task failed: {e}")))?
}

/// Everything the user can browse. `refresh` re-fetches the remote index.
#[tauri::command]
pub async fn packs_catalog(refresh: bool, app: AppHandle, state: State<'_, VaultState>) -> Result<Catalog> {
    let (root, cache) = (root(&state)?, cache_dir(&app));
    off_thread(move || Ok(mk::catalog(&root, cache.as_deref(), refresh, true))).await
}

/// A pack's manifest, file list, and the plan for installing it here.
#[tauri::command]
pub async fn packs_show(id: String, force: bool, app: AppHandle, state: State<'_, VaultState>) -> Result<(Pack, Plan)> {
    let (root, cache) = (root(&state)?, cache_dir(&app));
    off_thread(move || {
        let pack = mk::resolve(&root, cache.as_deref(), &id, true)?;
        let plan = mk::plan(&root, &pack, force);
        Ok((pack, plan))
    }).await
}

#[tauri::command]
pub async fn packs_install(id: String, force: bool, app: AppHandle, state: State<'_, VaultState>) -> Result<Vec<InstallReport>> {
    let (root, cache) = (root(&state)?, cache_dir(&app));
    off_thread(move || {
        let pack = mk::resolve(&root, cache.as_deref(), &id, true)?;
        let r2 = root.clone();
        mk::install(&root, &pack, force, &move |inner| mk::resolve(&r2, cache.as_deref(), inner, true).ok())
    }).await
}

#[tauri::command]
pub async fn packs_update(id: String, app: AppHandle, state: State<'_, VaultState>) -> Result<UpdateReport> {
    let (root, cache) = (root(&state)?, cache_dir(&app));
    off_thread(move || {
        let pack = mk::resolve(&root, cache.as_deref(), &id, true)?;
        mk::update(&root, &pack)
    }).await
}

#[tauri::command]
pub async fn packs_remove(id: String, state: State<'_, VaultState>) -> Result<RemoveReport> {
    let root = root(&state)?;
    off_thread(move || mk::remove(&root, &id)).await
}

/// What the pack's page shows: each collection's properties, views, row
/// template and seed count, the note templates, a bundle's parts — parsed
/// in core, so the page never reads YAML itself.
#[tauri::command]
pub async fn packs_preview(id: String, app: AppHandle, state: State<'_, VaultState>) -> Result<PackPreview> {
    let (root, cache) = (root(&state)?, cache_dir(&app));
    off_thread(move || {
        let pack = mk::resolve(&root, cache.as_deref(), &id, true)?;
        Ok(mk::preview(&pack))
    }).await
}

/// Start a pack directory from a template or collection in this vault.
#[tauri::command]
pub async fn packs_export(id: String, from: String, out_dir: String, state: State<'_, VaultState>) -> Result<String> {
    let root = root(&state)?;
    off_thread(move || Ok(mk::export(&root, &id, &from, std::path::Path::new(&out_dir))?.to_string_lossy().into_owned())).await
}
