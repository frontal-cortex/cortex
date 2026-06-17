//! Tauri command layer for team members + current-user identity.

use tauri::State;

use crate::commands::vault::VaultState;
use crate::error::{AppError, Result};
use crate::members::{CurrentUser, Member};

fn root(state: &State<'_, VaultState>) -> Result<std::path::PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

#[tauri::command]
pub fn get_members(state: State<'_, VaultState>) -> Result<Vec<Member>> {
    Ok(crate::members::load(&root(&state)?))
}

#[tauri::command]
pub fn set_members(members: Vec<Member>, state: State<'_, VaultState>) -> Result<()> {
    crate::members::save(&root(&state)?, &members)
}

/// The current user's git identity — used to highlight "me" and key per-user
/// daily notes.
#[tauri::command]
pub fn current_user(state: State<'_, VaultState>) -> Result<CurrentUser> {
    Ok(crate::members::current_user(&root(&state)?))
}
