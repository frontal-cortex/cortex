//! User configuration that lives in `.cortex/` — committed, human-readable YAML,
//! portable to any clone. This is distinct from `.brain/`, which is a
//! gitignored, rebuildable cache.

use std::path::{Path, PathBuf};
use tauri::State;

use crate::commands::vault::VaultState;
use cortex_core::error::{AppError, Result};

fn vault_path(state: &State<'_, VaultState>) -> Result<PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

fn cortex_dir(root: &Path) -> PathBuf {
    root.join(".cortex")
}

// ── Settings ───────────────────────────────────────────────────────────────────

pub use cortex_core::settings::Settings;

#[tauri::command]
pub fn get_settings(state: State<'_, VaultState>) -> Result<Settings> {
    cortex_core::settings::load(&vault_path(&state)?)
}

#[tauri::command]
pub fn set_settings(settings: Settings, state: State<'_, VaultState>) -> Result<()> {
    cortex_core::settings::save(&vault_path(&state)?, &settings)
}

// ── Favorites ──────────────────────────────────────────────────────────────────
//
// Moved from `.brain/favorites.json` (gitignored, not portable) to
// `.cortex/favorites.yaml` (committed, readable). Old vaults are migrated
// transparently on first read.

#[tauri::command]
pub fn get_favorites(state: State<'_, VaultState>) -> Result<Vec<String>> {
    let root = vault_path(&state)?;
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

#[tauri::command]
pub fn set_favorites(paths: Vec<String>, state: State<'_, VaultState>) -> Result<()> {
    let root = vault_path(&state)?;
    write_favorites(&root, &paths)
}

fn write_favorites(root: &Path, favs: &[String]) -> Result<()> {
    let dir = cortex_dir(root);
    std::fs::create_dir_all(&dir)?;
    let yaml = serde_yaml::to_string(&favs)?;
    std::fs::write(dir.join("favorites.yaml"), yaml)?;
    Ok(())
}
