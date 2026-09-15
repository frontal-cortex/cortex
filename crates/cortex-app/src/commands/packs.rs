//! Template marketplace commands — thin wrappers over `cortex_core::marketplace`.
//! Every one is an explicit user action from the Marketplace page; nothing
//! fetches or installs on its own. The remote index is cached under the
//! app's cache directory and refreshed only when the page asks.


use crate::ctx::AppCtx;
use cortex_core::error::Result;
use cortex_core::marketplace::{self as mk, Catalog, InstallReport, Pack, PackPreview, Plan, RemoveReport, UpdateReport};


fn cache_dir(ctx: &AppCtx) -> Option<std::path::PathBuf> {
    ctx.cache_dir().ok().map(|d| d.join("marketplace"))
}

use super::off_thread;

/// Everything the user can browse. `refresh` re-fetches the remote index.
pub fn packs_catalog(ctx: &AppCtx, refresh: bool) -> Result<Catalog> {
    let (root, cache) = (ctx.vault_path()?, cache_dir(ctx));
    off_thread(move || Ok(mk::catalog(&root, cache.as_deref(), refresh, true)))
}

/// A pack's manifest, file list, and the plan for installing it here.
pub fn packs_show(ctx: &AppCtx, id: String, force: bool) -> Result<(Pack, Plan)> {
    let (root, cache) = (ctx.vault_path()?, cache_dir(ctx));
    off_thread(move || {
        let pack = mk::resolve(&root, cache.as_deref(), &id, true)?;
        let plan = mk::plan(&root, &pack, force);
        Ok((pack, plan))
    })
}
pub fn packs_install(ctx: &AppCtx, id: String, force: bool) -> Result<Vec<InstallReport>> {
    let (root, cache) = (ctx.vault_path()?, cache_dir(ctx));
    off_thread(move || {
        let pack = mk::resolve(&root, cache.as_deref(), &id, true)?;
        let r2 = root.clone();
        mk::install(&root, &pack, force, &move |inner| mk::resolve(&r2, cache.as_deref(), inner, true).ok())
    })
}
pub fn packs_update(ctx: &AppCtx, id: String) -> Result<UpdateReport> {
    let (root, cache) = (ctx.vault_path()?, cache_dir(ctx));
    off_thread(move || {
        let pack = mk::resolve(&root, cache.as_deref(), &id, true)?;
        mk::update(&root, &pack)
    })
}
pub fn packs_remove(ctx: &AppCtx, id: String) -> Result<RemoveReport> {
    let root = ctx.vault_path()?;
    off_thread(move || mk::remove(&root, &id))
}

/// What the pack's page shows: each collection's properties, views, row
/// template and seed count, the note templates, a bundle's parts — parsed
/// in core, so the page never reads YAML itself.
pub fn packs_preview(ctx: &AppCtx, id: String) -> Result<PackPreview> {
    let (root, cache) = (ctx.vault_path()?, cache_dir(ctx));
    off_thread(move || {
        let pack = mk::resolve(&root, cache.as_deref(), &id, true)?;
        Ok(mk::preview(&pack))
    })
}

/// Start a pack directory from a template or collection in this vault.
pub fn packs_export(ctx: &AppCtx, id: String, from: String, out_dir: String) -> Result<String> {
    let root = ctx.vault_path()?;
    off_thread(move || Ok(mk::export(&root, &id, &from, std::path::Path::new(&out_dir))?.to_string_lossy().into_owned()))
}
