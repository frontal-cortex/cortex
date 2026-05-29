//! User configuration that lives in `.cortex/` — committed, human-readable YAML,
//! portable to any clone. This is distinct from `.brain/`, which is a
//! gitignored, rebuildable cache.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

use crate::commands::vault::VaultState;
use crate::error::{AppError, Result};

fn vault_path(state: &State<'_, VaultState>) -> Result<PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

fn cortex_dir(root: &Path) -> PathBuf {
    root.join(".cortex")
}

// ── Settings ───────────────────────────────────────────────────────────────────

/// App settings, stored at `.cortex/settings.yaml`. Every field has a default so
/// a missing key (or a missing file) is never an error — the vault stays usable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub auto_commit: bool,
    #[serde(default = "default_note_type")]
    pub default_note_type: String,
    #[serde(default = "default_journal_template")]
    pub journal_template: String,
    /// "light" | "dark" | "system"
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Days before trashed notes are auto-pruned. 0 = never.
    #[serde(default = "default_trash_retention")]
    pub trash_retention_days: u32,
}

fn default_note_type() -> String { "note".into() }
fn default_journal_template() -> String { "daily.md".into() }
fn default_theme() -> String { "system".into() }
fn default_trash_retention() -> u32 { 30 }

impl Default for Settings {
    fn default() -> Self {
        Settings {
            auto_commit: false,
            default_note_type: default_note_type(),
            journal_template: default_journal_template(),
            theme: default_theme(),
            trash_retention_days: default_trash_retention(),
        }
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, VaultState>) -> Result<Settings> {
    let root = vault_path(&state)?;
    let path = cortex_dir(&root).join("settings.yaml");
    if !path.exists() {
        return Ok(Settings::default());
    }
    let content = std::fs::read_to_string(&path)?;
    // Tolerate a malformed/partial file rather than blocking the whole app.
    Ok(serde_yaml::from_str(&content).unwrap_or_default())
}

#[tauri::command]
pub fn set_settings(settings: Settings, state: State<'_, VaultState>) -> Result<()> {
    let root = vault_path(&state)?;
    let dir = cortex_dir(&root);
    std::fs::create_dir_all(&dir)?;
    let yaml = serde_yaml::to_string(&settings)?;
    std::fs::write(dir.join("settings.yaml"), yaml)?;
    Ok(())
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
