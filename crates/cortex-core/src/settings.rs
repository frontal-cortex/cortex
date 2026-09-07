//! Vault settings — `.cortex/settings.yaml`, committed and human-readable.
//! Every field has a default so a missing key (or file) is never an error.

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::error::Result;

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
    /// Minutes between automatic syncs (plus on-launch and on-focus). 0 = off.
    #[serde(default)]
    pub auto_sync_minutes: u32,
    /// Yjs websocket relay for presence + real-time co-editing (e.g.
    /// `ws://office-server:1234`). Empty = collaboration features off.
    #[serde(default)]
    pub collab_url: String,
    /// Palette file to follow — Omarchy's `colors.toml` shape (see theme.rs).
    /// `~` is expanded per machine; a missing file silently falls back to
    /// `theme`, so the setting can be committed with the vault.
    #[serde(default)]
    pub theme_file: String,
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
            auto_sync_minutes: 0,
            collab_url: String::new(),
            theme_file: String::new(),
        }
    }
}

pub fn load(root: &Path) -> Result<Settings> {
    let path = root.join(".cortex").join("settings.yaml");
    if !path.exists() {
        return Ok(Settings::default());
    }
    let content = std::fs::read_to_string(&path)?;
    // Tolerate a malformed/partial file rather than blocking the whole app.
    Ok(serde_yaml::from_str(&content).unwrap_or_default())
}

pub fn save(root: &Path, settings: &Settings) -> Result<()> {
    let dir = root.join(".cortex");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("settings.yaml"), serde_yaml::to_string(settings)?)?;
    Ok(())
}
