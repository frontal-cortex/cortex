use tauri::State;

use crate::commands::vault::VaultState;
use crate::error::{AppError, Result};
use crate::git::{self, AgentBranch, CommitDiff, CommitEntry, VaultStatus};

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
