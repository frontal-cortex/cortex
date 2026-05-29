use tauri::State;

use crate::commands::vault::{DbState, VaultState};
use crate::error::{AppError, Result};
use crate::git::{self, AgentBranch, CommitDiff, CommitEntry, VaultStatus};
use crate::note::{self, Note};

fn open_repo(state: &State<'_, VaultState>) -> Result<git2::Repository> {
    let guard = state.0.lock().unwrap();
    let path = guard.as_ref().ok_or(AppError::NoVault)?;
    git2::Repository::open(path).map_err(AppError::Git)
}

#[tauri::command]
pub fn git_status(state: State<'_, VaultState>) -> Result<VaultStatus> {
    let repo = open_repo(&state)?;
    git::get_status(&repo)
}

#[tauri::command]
pub fn git_commit(message: String, state: State<'_, VaultState>) -> Result<()> {
    let repo = open_repo(&state)?;
    git::stage_all_and_commit(&repo, &message)
}

#[tauri::command]
pub fn git_sync(state: State<'_, VaultState>) -> Result<()> {
    let guard = state.0.lock().unwrap();
    let path = guard.as_ref().ok_or(AppError::NoVault)?;

    // Shell out to git for push/pull to leverage system credentials / SSH agent
    let output = std::process::Command::new("git")
        .args(["pull", "--rebase", "origin", "HEAD"])
        .current_dir(path)
        .output()?;

    if !output.status.success() {
        return Err(AppError::Other(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    let output = std::process::Command::new("git")
        .args(["push", "origin", "HEAD"])
        .current_dir(path)
        .output()?;

    if !output.status.success() {
        return Err(AppError::Other(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    Ok(())
}

#[tauri::command]
pub fn git_log(limit: usize, state: State<'_, VaultState>) -> Result<Vec<CommitEntry>> {
    let repo = open_repo(&state)?;
    git::get_log(&repo, limit)
}

#[tauri::command]
pub fn git_diff(hash: String, state: State<'_, VaultState>) -> Result<CommitDiff> {
    let repo = open_repo(&state)?;
    git::get_commit_diff(&repo, &hash)
}

// ── Per-note history ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn note_history(
    path: String,
    limit: usize,
    state: State<'_, VaultState>,
) -> Result<Vec<CommitEntry>> {
    let repo = open_repo(&state)?;
    git::get_note_history(&repo, &path, limit)
}

#[tauri::command]
pub fn note_at(path: String, hash: String, state: State<'_, VaultState>) -> Result<String> {
    let repo = open_repo(&state)?;
    git::get_note_at(&repo, &path, &hash)
}

/// Restore a note to a previous version by writing the historical content back
/// to the working file. Non-destructive: the current version stays in history,
/// and this just creates a new working-tree state the user can commit.
#[tauri::command]
pub fn restore_note(
    path: String,
    hash: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<Note> {
    let content = {
        let repo = open_repo(&state)?;
        git::get_note_at(&repo, &path, &hash)?
    };

    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    let abs = root.join(&path);
    std::fs::write(&abs, &content)?;

    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = crate::commands::indexer::index_file(&root, &abs, db);
    }

    note::parse_note(&path, &content)
}

#[tauri::command]
pub fn list_agent_branches(state: State<'_, VaultState>) -> Result<Vec<AgentBranch>> {
    let repo = open_repo(&state)?;
    git::list_agent_branches(&repo)
}

#[tauri::command]
pub fn apply_agent_branch(branch_name: String, state: State<'_, VaultState>) -> Result<()> {
    let repo = open_repo(&state)?;
    git::apply_agent_branch(&repo, &branch_name)
}

#[tauri::command]
pub fn discard_agent_branch(branch_name: String, state: State<'_, VaultState>) -> Result<()> {
    let repo = open_repo(&state)?;
    git::discard_agent_branch(&repo, &branch_name)
}
