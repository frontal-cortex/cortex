//! User configuration that lives in `.cortex/` — committed, human-readable YAML,
//! portable to any clone. This is distinct from `.brain/`, which is a
//! gitignored, rebuildable cache.

use crate::ctx::AppCtx;
use std::path::{Path, PathBuf};

use cortex_core::error::Result;

fn cortex_dir(root: &Path) -> PathBuf {
    root.join(".cortex")
}

// ── Settings ───────────────────────────────────────────────────────────────────

pub use cortex_core::settings::Settings;
pub fn get_settings(ctx: &AppCtx) -> Result<Settings> {
    cortex_core::settings::load(&ctx.vault_path()?)
}
pub fn set_settings(ctx: &AppCtx, settings: Settings) -> Result<()> {
    cortex_core::settings::save(&ctx.vault_path()?, &settings)
}

// ── Favorites ──────────────────────────────────────────────────────────────────
//
// Moved from `.brain/favorites.json` (gitignored, not portable) to
// `.cortex/favorites.yaml` (committed, readable). Old vaults are migrated
// transparently on first read.
pub fn get_favorites(ctx: &AppCtx) -> Result<Vec<String>> {
    let root = ctx.vault_path()?;
    let yaml_path = cortex_dir(&root).join("favorites.yaml");

    if yaml_path.exists() {
        let content = std::fs::read_to_string(&yaml_path)?;
        return Ok(serde_yaml::from_str(&content).unwrap_or_default());
    }

    // Migrate legacy `.brain/favorites.json` if present.
    let legacy = root.join(".brain").join("favorites.json");
    if legacy.exists() {
        let content = std::fs::read_to_string(&legacy)?;
        let favs: Vec<String> = serde_json::from_str(&content).unwrap_or_default();
        write_favorites(&root, &favs)?;
        let _ = std::fs::remove_file(&legacy);
        return Ok(favs);
    }

    Ok(vec![])
}
pub fn set_favorites(ctx: &AppCtx, paths: Vec<String>) -> Result<()> {
    let root = ctx.vault_path()?;
    write_favorites(&root, &paths)
}

fn write_favorites(root: &Path, favs: &[String]) -> Result<()> {
    let dir = cortex_dir(root);
    std::fs::create_dir_all(&dir)?;
    let yaml = serde_yaml::to_string(&favs)?;
    std::fs::write(dir.join("favorites.yaml"), yaml)?;
    Ok(())
}
