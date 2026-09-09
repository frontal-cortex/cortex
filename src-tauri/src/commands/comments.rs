//! Comment threads — thin wrappers over `cortex_core::comments`. Every write
//! lands in the note's `.comments.yaml` sidecar and returns the full thread
//! list, so the panel never has to merge.

use tauri::State;

use crate::commands::vault::VaultState;
use cortex_core::comments::{self, Anchor, Thread};
use cortex_core::error::{AppError, Result};

fn root(state: &State<'_, VaultState>) -> Result<std::path::PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

#[tauri::command]
pub fn list_comments(path: String, state: State<'_, VaultState>) -> Result<Vec<Thread>> {
    comments::load(&root(&state)?, &path)
}

/// Open a thread; `anchor` is the selected passage (none = the whole note).
#[tauri::command]
pub fn add_comment(path: String, text: String, anchor: Option<Anchor>, state: State<'_, VaultState>) -> Result<Vec<Thread>> {
    let root = root(&state)?;
    comments::add(&root, &path, anchor, &text, None)?;
    comments::load(&root, &path)
}

#[tauri::command]
pub fn reply_comment(path: String, id: String, text: String, state: State<'_, VaultState>) -> Result<Vec<Thread>> {
    let root = root(&state)?;
    comments::reply(&root, &path, &id, &text, None)?;
    comments::load(&root, &path)
}

#[tauri::command]
pub fn resolve_comment(path: String, id: String, resolved: bool, state: State<'_, VaultState>) -> Result<Vec<Thread>> {
    let root = root(&state)?;
    comments::resolve(&root, &path, &id, resolved)?;
    comments::load(&root, &path)
}

#[tauri::command]
pub fn delete_comment(path: String, id: String, state: State<'_, VaultState>) -> Result<Vec<Thread>> {
    let root = root(&state)?;
    comments::delete(&root, &path, &id)?;
    comments::load(&root, &path)
}
