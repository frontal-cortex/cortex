//! Recently opened vaults — a small, global (cross-vault) list stored in the
//! app config directory, *not* inside any vault. Lets the home screen suggest
//! vaults the user has opened before.
//!
//! Recently opened *notes* are per vault and live in its gitignored
//! `.brain/ui-state.json` (`cortex_core::ui_state`); the two commands at the
//! bottom expose that list to the sidebar and the quick switcher.

use crate::ctx::AppCtx;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use cortex_core::error::Result;

const MAX_RECENT: usize = 8;
const FILE_NAME: &str = "recent_vaults.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentVault {
    pub path: String,
    pub name: String,
    /// Unix seconds of the last time this vault was opened.
    pub last_opened: u64,
}

fn recents_file(ctx: &AppCtx) -> Result<PathBuf> {
    let dir = ctx.config_dir()?;
    Ok(dir.join(FILE_NAME))
}

fn read_recents(ctx: &AppCtx) -> Vec<RecentVault> {
    let Ok(file) = recents_file(ctx) else {
        return vec![];
    };
    std::fs::read_to_string(&file)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

/// Record `vault_path` as the most recently opened vault. Best-effort: any
/// failure (no config dir, unwritable file) is swallowed so it can never block
/// opening a vault.
pub fn record_recent(ctx: &AppCtx, vault_path: &Path) {
    let path = vault_path.to_string_lossy().to_string();
    let name = vault_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("vault")
        .to_string();
    let last_opened = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut recents = read_recents(ctx);
    // Move-to-front: drop any existing entry for this path, then prepend.
    recents.retain(|r| r.path != path);
    recents.insert(0, RecentVault { path, name, last_opened });
    recents.truncate(MAX_RECENT);

    if let (Ok(file), Ok(json)) = (recents_file(ctx), serde_json::to_string_pretty(&recents)) {
        let _ = std::fs::write(file, json);
    }
}

/// Recently opened vaults, most-recent first. Entries whose directory no longer
/// exists are filtered out so the home screen never suggests a dead path.
pub fn get_recent_vaults(ctx: &AppCtx) -> Result<Vec<RecentVault>> {
    Ok(read_recents(ctx)
        .into_iter()
        .filter(|r| Path::new(&r.path).is_dir())
        .collect())
}

/// Drop `path` from the recent list — the vault itself is untouched. Returns
/// the list as the home screen should now show it.
pub fn forget_recent(ctx: &AppCtx, path: String) -> Result<Vec<RecentVault>> {
    let mut recents = read_recents(ctx);
    recents.retain(|r| r.path != path);
    if let (Ok(file), Ok(json)) = (recents_file(ctx), serde_json::to_string_pretty(&recents)) {
        std::fs::write(file, json)?;
    }
    Ok(recents.into_iter().filter(|r| Path::new(&r.path).is_dir()).collect())
}

// ── Recent notes (per vault, `.brain/ui-state.json`) ──────────────────────────

/// The last notes opened in this vault, most recent first; deleted notes are skipped.
pub fn get_recent_notes(ctx: &AppCtx) -> Result<Vec<String>> {
    Ok(cortex_core::ui_state::recent_notes(&ctx.vault_path()?))
}

/// Remember that `path` was just opened. Returns the updated list.
pub fn record_recent_note(ctx: &AppCtx, path: String) -> Result<Vec<String>> {
    cortex_core::ui_state::record_recent_note(&ctx.vault_path()?, &path)
}
