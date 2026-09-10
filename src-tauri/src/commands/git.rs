use tauri::State;

use crate::commands::vault::{DbState, VaultState};
use cortex_core::error::{AppError, Result};
use cortex_core::git::{self, AgentBranch, CommitDiff, CommitEntry, VaultStatus};
use cortex_core::note::{self, Note};

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
pub async fn git_commit(message: String, state: State<'_, VaultState>) -> Result<()> {
    let root = vault_dir(&state)?;
    super::off_thread(move || {
        let repo = git2::Repository::open(&root).map_err(AppError::Git)?;
        git::stage_all_and_commit(&repo, &message)
    }).await
}

fn vault_dir(state: &State<'_, VaultState>) -> Result<std::path::PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

/// Full sync: auto-commit dirty work, merge in the remote, push. Returns a
/// structured outcome — `conflicts` means the repo is mid-merge with marker'd
/// files awaiting resolution (see `git_resolve_conflict` / `git_complete_merge`).
#[tauri::command]
pub async fn git_sync(state: State<'_, VaultState>) -> Result<git::SyncOutcome> {
    let root = vault_dir(&state)?;
    super::off_thread(move || git::sync_vault(&root)).await
}

/// Files currently conflicted (e.g. to recover the resolution UI after a restart).
#[tauri::command]
pub fn git_conflicts(state: State<'_, VaultState>) -> Result<Vec<String>> {
    git::list_conflicts(&vault_dir(&state)?)
}

/// Resolve one conflicted file: `side` is "ours", "theirs", or "manual" (the
/// user already edited the markers away in the editor).
#[tauri::command]
pub fn git_resolve_conflict(
    file: String,
    side: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    let root = vault_dir(&state)?;
    git::resolve_conflict(&root, &file, &side)?;
    // The resolved file changed on disk — keep the search index in step.
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = cortex_core::index::index_file(&root, &root.join(&file), db);
    }
    Ok(())
}

/// Conclude a fully-resolved merge: commit and push.
#[tauri::command]
pub fn git_complete_merge(state: State<'_, VaultState>) -> Result<git::SyncOutcome> {
    git::complete_merge(&vault_dir(&state)?)
}

/// Abandon the in-progress merge; local commits stay, remote changes un-apply.
#[tauri::command]
pub fn git_abort_merge(state: State<'_, VaultState>) -> Result<()> {
    git::abort_merge(&vault_dir(&state)?)
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

/// Who created and last edited a note, and when — from git history, with the
/// file's mtime standing in outside a repository. The values the
/// `created_time` / `created_by` / `edited_time` / `edited_by` property types
/// show in a data view; the properties panel asks for one note.
#[tauri::command]
pub fn note_authorship(path: String, state: State<'_, VaultState>) -> Result<git::Authorship> {
    let root = state.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    if path.contains("..") { return Err(AppError::Other("Invalid path".into())); }
    Ok(git::authorship_of(&root, &path))
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
        let _ = cortex_core::index::index_file(&root, &abs, db);
    }

    note::parse_note(&path, &content)
}

#[tauri::command]
pub fn list_agent_branches(state: State<'_, VaultState>) -> Result<Vec<AgentBranch>> {
    let repo = open_repo(&state)?;
    git::list_agent_branches(&repo)
}

/// What a proposal would change — the diff the user reviews before applying.
#[tauri::command]
pub fn agent_branch_diff(branch_name: String, state: State<'_, VaultState>) -> Result<CommitDiff> {
    let repo = open_repo(&state)?;
    git::get_branch_diff(&repo, &branch_name)
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
