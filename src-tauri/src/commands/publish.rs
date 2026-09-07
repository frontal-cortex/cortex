//! Publishing commands — thin wrappers over `cortex_core::publish`. Every one
//! of these is invoked from an explicit user action in the Publish dialog;
//! nothing in the app calls them on save, sync, or a timer.

use tauri::State;

use cortex_core::error::{AppError, Result};
use cortex_core::publish::{self, PagesPush, PublishEntry, Report};

use super::vault::VaultState;

fn root(state: &State<'_, VaultState>) -> Result<std::path::PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

/// The notes that would be published, without writing anything.
#[tauri::command]
pub fn publish_preview(state: State<'_, VaultState>) -> Result<Vec<PublishEntry>> {
    publish::preview(&root(&state)?)
}

/// Build the site into a folder the user picked.
#[tauri::command]
pub fn publish_to_dir(dir: String, force: bool, state: State<'_, VaultState>) -> Result<Report> {
    publish::build(&root(&state)?, std::path::Path::new(&dir), force)
}

/// Build and force-push the site as an orphan branch on the vault's remote.
#[tauri::command]
pub fn publish_gh_pages(remote: String, branch: String, state: State<'_, VaultState>) -> Result<PagesPush> {
    publish::push_gh_pages(&root(&state)?, &remote, &branch)
}

/// Write the manual-trigger GitHub Pages workflow into the vault.
#[tauri::command]
pub fn publish_write_github_action(state: State<'_, VaultState>) -> Result<String> {
    Ok(publish::write_github_action(&root(&state)?)?.to_string_lossy().into_owned())
}
