
use crate::ctx::AppCtx;
use cortex_core::error::{AppError, Result};
use cortex_core::git::{self, AgentBranch, CommitDiff, CommitEntry, VaultStatus};
use cortex_core::note::{self, Note};

fn open_repo(ctx: &AppCtx) -> Result<git2::Repository> {
    let guard = ctx.vault.0.lock().unwrap();
    let path = guard.as_ref().ok_or(AppError::NoVault)?;
    git2::Repository::open(path).map_err(AppError::Git)
}
pub fn git_status(ctx: &AppCtx) -> Result<VaultStatus> {
    let repo = open_repo(ctx)?;
    git::get_status(&repo)
}
pub fn git_commit(ctx: &AppCtx, message: String) -> Result<()> {
    let root = ctx.vault_path()?;
    super::off_thread(move || {
        let repo = git2::Repository::open(&root).map_err(AppError::Git)?;
        git::stage_all_and_commit(&repo, &message)
    })
}

/// Full sync: auto-commit dirty work, merge in the remote, push. Returns a
/// structured outcome — `conflicts` means the repo is mid-merge with marker'd
/// files awaiting resolution (see `git_resolve_conflict` / `git_complete_merge`).
pub fn git_sync(ctx: &AppCtx) -> Result<git::SyncOutcome> {
    let root = ctx.vault_path()?;
    super::off_thread(move || git::sync_vault(&root))
}

/// Files currently conflicted (e.g. to recover the resolution UI after a restart).
pub fn git_conflicts(ctx: &AppCtx) -> Result<Vec<String>> {
    git::list_conflicts(&ctx.vault_path()?)
}

/// Resolve one conflicted file: `side` is "ours", "theirs", or "manual" (the
/// user already edited the markers away in the editor).
pub fn git_resolve_conflict(ctx: &AppCtx, file: String, side: String) -> Result<()> {
    let root = ctx.vault_path()?;
    git::resolve_conflict(&root, &file, &side)?;
    // The resolved file changed on disk — keep the search index in step.
    if let Some(db) = ctx.db.0.lock().unwrap().as_ref() {
        let _ = cortex_core::index::index_file(&root, &root.join(&file), db);
    }
    Ok(())
}

/// Conclude a fully-resolved merge: commit and push.
pub fn git_complete_merge(ctx: &AppCtx) -> Result<git::SyncOutcome> {
    git::complete_merge(&ctx.vault_path()?)
}

/// Abandon the in-progress merge; local commits stay, remote changes un-apply.
pub fn git_abort_merge(ctx: &AppCtx) -> Result<()> {
    git::abort_merge(&ctx.vault_path()?)
}
pub fn git_log(ctx: &AppCtx, limit: usize) -> Result<Vec<CommitEntry>> {
    let repo = open_repo(ctx)?;
    git::get_log(&repo, limit)
}
pub fn git_diff(ctx: &AppCtx, hash: String) -> Result<CommitDiff> {
    let repo = open_repo(ctx)?;
    git::get_commit_diff(&repo, &hash)
}

// ── Per-note history ───────────────────────────────────────────────────────────
pub fn note_history(ctx: &AppCtx, path: String, limit: usize) -> Result<Vec<CommitEntry>> {
    let repo = open_repo(ctx)?;
    git::get_note_history(&repo, &path, limit)
}

/// Who created and last edited a note, and when — from git history, with the
/// file's mtime standing in outside a repository. The values the
/// `created_time` / `created_by` / `edited_time` / `edited_by` property types
/// show in a data view; the properties panel asks for one note.
pub fn note_authorship(ctx: &AppCtx, path: String) -> Result<git::Authorship> {
    let root = ctx.vault.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    if path.contains("..") { return Err(AppError::Other("Invalid path".into())); }
    Ok(git::authorship_of(&root, &path))
}
pub fn note_at(ctx: &AppCtx, path: String, hash: String) -> Result<String> {
    let repo = open_repo(ctx)?;
    git::get_note_at(&repo, &path, &hash)
}

/// Restore a note to a previous version by writing the historical content back
/// to the working file. Non-destructive: the current version stays in history,
/// and this just creates a new working-tree state the user can commit.
pub fn restore_note(ctx: &AppCtx, path: String, hash: String) -> Result<Note> {
    let content = {
        let repo = open_repo(ctx)?;
        git::get_note_at(&repo, &path, &hash)?
    };

    let root = ctx.vault.0.lock().unwrap().clone().ok_or(AppError::NoVault)?;
    let abs = root.join(&path);
    std::fs::write(&abs, &content)?;

    if let Some(db) = ctx.db.0.lock().unwrap().as_ref() {
        let _ = cortex_core::index::index_file(&root, &abs, db);
    }

    note::parse_note(&path, &content)
}
pub fn list_agent_branches(ctx: &AppCtx) -> Result<Vec<AgentBranch>> {
    let repo = open_repo(ctx)?;
    git::list_agent_branches(&repo)
}

/// What a proposal would change — the diff the user reviews before applying.
pub fn agent_branch_diff(ctx: &AppCtx, branch_name: String) -> Result<CommitDiff> {
    let repo = open_repo(ctx)?;
    git::get_branch_diff(&repo, &branch_name)
}
pub fn apply_agent_branch(ctx: &AppCtx, branch_name: String) -> Result<()> {
    let repo = open_repo(ctx)?;
    git::apply_agent_branch(&repo, &branch_name)
}
pub fn discard_agent_branch(ctx: &AppCtx, branch_name: String) -> Result<()> {
    let repo = open_repo(ctx)?;
    git::discard_agent_branch(&repo, &branch_name)
}
