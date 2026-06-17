use git2::{Repository, Sort, StatusOptions, BranchType};
use serde::Serialize;
use std::path::Path;
use crate::error::{AppError, Result};

#[derive(Debug, Serialize)]
pub struct VaultStatus {
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Debug, Serialize)]
pub struct AgentBranch {
    pub name: String,
    pub description: String,
    pub commit_count: usize,
}

#[derive(Debug, Serialize)]
pub struct CommitEntry {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: u64,
}

pub fn get_log(repo: &Repository, limit: usize) -> Result<Vec<CommitEntry>> {
    let mut revwalk = repo.revwalk()?;

    // Fresh repo with no commits — return empty without error
    if revwalk.push_head().is_err() {
        return Ok(vec![]);
    }

    revwalk.set_sorting(Sort::TIME)?;

    let entries = revwalk
        .take(limit)
        .filter_map(|id| id.ok())
        .filter_map(|id| repo.find_commit(id).ok())
        .map(|commit| CommitEntry {
            hash: commit.id().to_string(),
            message: commit.summary().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            timestamp: commit.time().seconds() as u64,
        })
        .collect();

    Ok(entries)
}

#[derive(Debug, Serialize)]
pub struct CommitDiff {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: u64,
    pub patch: String,
}

/// Return the commits that changed a specific file, newest first. Only versions
/// where the file *exists* afterward are returned (so every entry is
/// restorable). This is the equivalent of `git log -- <path>`.
pub fn get_note_history(repo: &Repository, path: &str, limit: usize) -> Result<Vec<CommitEntry>> {
    let mut revwalk = repo.revwalk()?;
    if revwalk.push_head().is_err() {
        return Ok(vec![]);
    }
    revwalk.set_sorting(Sort::TIME)?;

    let target = std::path::Path::new(path);
    let mut out = Vec::new();

    for oid in revwalk {
        let Ok(oid) = oid else { continue };
        let Ok(commit) = repo.find_commit(oid) else { continue };
        let Ok(tree) = commit.tree() else { continue };

        let cur = tree.get_path(target).ok().map(|e| e.id());
        // Compare against the first parent's version of the same path.
        let parent = if commit.parent_count() > 0 {
            commit
                .parent(0)
                .ok()
                .and_then(|p| p.tree().ok())
                .and_then(|t| t.get_path(target).ok().map(|e| e.id()))
        } else {
            None
        };

        // Include only commits where the file changed AND still exists (a
        // deletion would have `cur == None` — not a restorable version).
        if cur != parent && cur.is_some() {
            out.push(CommitEntry {
                hash: commit.id().to_string(),
                message: commit.summary().unwrap_or("").to_string(),
                author: commit.author().name().unwrap_or("").to_string(),
                timestamp: commit.time().seconds() as u64,
            });
            if out.len() >= limit {
                break;
            }
        }
    }

    Ok(out)
}

/// Read the contents of a file as it existed at a specific commit.
pub fn get_note_at(repo: &Repository, path: &str, hash: &str) -> Result<String> {
    let oid = git2::Oid::from_str(hash).map_err(AppError::Git)?;
    let commit = repo.find_commit(oid)?;
    let tree = commit.tree()?;
    let entry = tree
        .get_path(std::path::Path::new(path))
        .map_err(|_| AppError::Other(format!("File not found in {hash}: {path}")))?;
    let blob = repo.find_blob(entry.id())?;
    Ok(String::from_utf8_lossy(blob.content()).to_string())
}

pub fn get_commit_diff(repo: &Repository, hash: &str) -> Result<CommitDiff> {
    let oid = git2::Oid::from_str(hash).map_err(AppError::Git)?;
    let commit = repo.find_commit(oid)?;

    // Collect metadata before borrowing for the diff
    let short_hash  = format!("{:.7}", commit.id());
    let message     = commit.summary().unwrap_or("").to_string();
    let author      = commit.author().name().unwrap_or("").to_string();
    let timestamp   = commit.time().seconds() as u64;

    let tree = commit.tree()?;

    // Store parent commit as an owned value so parent_tree can borrow it
    let parent_commit = if commit.parent_count() > 0 {
        Some(commit.parent(0)?)
    } else {
        None
    };
    let parent_tree = parent_commit.as_ref().map(|p| p.tree()).transpose()?;

    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;

    let mut patch = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        let content = std::str::from_utf8(line.content()).unwrap_or("");
        match origin {
            '+' | '-' | ' ' => { patch.push(origin); patch.push_str(content); }
            _ => { patch.push_str(content); }
        }
        true
    })?;

    Ok(CommitDiff { hash: short_hash, message, author, timestamp, patch })
}

pub fn open_or_init(vault_path: &Path) -> Result<Repository> {
    Repository::open(vault_path)
        .or_else(|_| Repository::init(vault_path))
        .map_err(AppError::Git)
}

pub fn get_status(repo: &Repository) -> Result<VaultStatus> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);

    let statuses = repo.statuses(Some(&mut opts))?;
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let s = entry.status();

        if s.contains(git2::Status::INDEX_NEW)
            || s.contains(git2::Status::INDEX_MODIFIED)
            || s.contains(git2::Status::INDEX_DELETED)
        {
            staged.push(path.clone());
        }
        if s.contains(git2::Status::WT_MODIFIED) || s.contains(git2::Status::WT_DELETED) {
            unstaged.push(path.clone());
        }
        if s.contains(git2::Status::WT_NEW) {
            untracked.push(path);
        }
    }

    let (ahead, behind) = upstream_divergence(repo).unwrap_or((0, 0));

    Ok(VaultStatus { staged, unstaged, untracked, ahead, behind })
}

fn upstream_divergence(repo: &Repository) -> Option<(usize, usize)> {
    let head = repo.head().ok()?;
    let branch_name = head.shorthand()?;
    let branch = repo.find_branch(branch_name, BranchType::Local).ok()?;
    let upstream = branch.upstream().ok()?;
    let local_oid = head.target()?;
    let upstream_oid = upstream.get().target()?;
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, upstream_oid).ok()?;
    Some((ahead, behind))
}

pub fn stage_all_and_commit(repo: &Repository, message: &str) -> Result<()> {
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
    index.write()?;

    let oid = index.write_tree()?;

    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    // Nothing actually changed — don't create an empty commit (auto-commit and
    // pre-sync commits call this unconditionally).
    if let Some(parent) = &parent_commit {
        if parent.tree_id() == oid {
            return Ok(());
        }
    }

    let tree = repo.find_tree(oid)?;
    let sig = repo.signature()?;
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
    Ok(())
}

// ── Sync (multi-user) ───────────────────────────────────────────────────────────
//
// Sync = auto-commit dirty work, `pull --no-rebase` (merge), push. Merge — not
// rebase — because on conflict it leaves ONE recoverable state: standard
// `<<<<<<<` markers in the files and MERGE_HEAD set, which is exactly what the
// resolution UI (and any git CLI user) can work with. A failed rebase would
// strand the repo mid-replay with no good in-app recovery.
//
// Push/pull shell out to system git so SSH agents and credential helpers work;
// everything else uses git2.

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum SyncOutcome {
    /// Synced cleanly. `pulled` = HEAD moved (remote changes landed on disk),
    /// so the caller should refresh its in-memory state.
    Ok { pulled: bool },
    /// The merge hit conflicts. The repo is mid-merge with marker'd files —
    /// resolve each (ours/theirs/manual) then `complete_merge`, or `abort_merge`.
    Conflicts { files: Vec<String> },
}

fn run_git(path: &Path, args: &[&str]) -> Result<std::process::Output> {
    Ok(std::process::Command::new("git")
        .args(args)
        .current_dir(path)
        .output()?)
}

fn git_stdout(path: &Path, args: &[&str]) -> Result<String> {
    let out = run_git(path, args)?;
    if !out.status.success() {
        return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn current_branch(path: &Path) -> Result<String> {
    // symbolic-ref (not rev-parse) so an unborn branch — a fresh vault with no
    // commits yet — still resolves to its name instead of erroring.
    git_stdout(path, &["symbolic-ref", "--short", "HEAD"])
        .map_err(|_| AppError::Other("Cannot sync: detached HEAD".into()))
}

fn head_oid(path: &Path) -> String {
    git_stdout(path, &["rev-parse", "HEAD"]).unwrap_or_default()
}

/// Files currently in the unmerged (conflicted) state.
pub fn list_conflicts(path: &Path) -> Result<Vec<String>> {
    let out = git_stdout(path, &["diff", "--name-only", "--diff-filter=U"])?;
    Ok(out.lines().map(str::to_string).filter(|l| !l.is_empty()).collect())
}

/// Full sync: commit dirty work, merge in the remote, push. Never leaves the
/// repo in a broken state — a conflicted merge is surfaced (recoverable), and
/// any other pull failure is rolled back with `merge --abort`.
pub fn sync_vault(path: &Path) -> Result<SyncOutcome> {
    // A merge already in progress (e.g. app restarted mid-resolution) takes
    // priority — surface it instead of stacking another pull on top.
    let existing = list_conflicts(path)?;
    if !existing.is_empty() {
        return Ok(SyncOutcome::Conflicts { files: existing });
    }

    // Commit local work first: a merge needs a clean tree, and "share my
    // current state" is what the user means by sync.
    {
        let repo = Repository::open(path)?;
        let st = get_status(&repo)?;
        if !(st.staged.is_empty() && st.unstaged.is_empty() && st.untracked.is_empty()) {
            stage_all_and_commit(&repo, "Auto-commit before sync")?;
        }
    }

    let branch = current_branch(path)?;
    let before = head_oid(path);

    let out = run_git(path, &["pull", "--no-rebase", "--no-edit", "origin", &branch])?;
    if !out.status.success() {
        let conflicts = list_conflicts(path)?;
        if !conflicts.is_empty() {
            return Ok(SyncOutcome::Conflicts { files: conflicts });
        }
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        // A brand-new branch the remote doesn't know yet isn't an error — there
        // is just nothing to pull. Anything else: restore a clean state.
        if !stderr.contains("couldn't find remote ref") {
            let _ = run_git(path, &["merge", "--abort"]);
            return Err(AppError::Other(stderr));
        }
    }
    let pulled = head_oid(path) != before;

    // `-u` keeps the upstream set so ahead/behind tracking works from the start.
    let out = run_git(path, &["push", "-u", "origin", &branch])?;
    if !out.status.success() {
        return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
    }

    Ok(SyncOutcome::Ok { pulled })
}

/// Resolve one conflicted file: take ours / theirs wholesale, or `manual` when
/// the user has already edited the markers away in the editor. Stages the file.
pub fn resolve_conflict(path: &Path, file: &str, side: &str) -> Result<()> {
    match side {
        "ours" | "theirs" => {
            let flag = if side == "ours" { "--ours" } else { "--theirs" };
            let out = run_git(path, &["checkout", flag, "--", file])?;
            if !out.status.success() {
                return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
            }
        }
        "manual" => {}
        other => return Err(AppError::Other(format!("Unknown resolution side '{other}'"))),
    }
    let out = run_git(path, &["add", "--", file])?;
    if !out.status.success() {
        return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
    }
    Ok(())
}

/// Conclude a fully-resolved merge: commit it and push. If conflicts remain,
/// returns them instead (the UI keeps the resolution flow open).
pub fn complete_merge(path: &Path) -> Result<SyncOutcome> {
    let remaining = list_conflicts(path)?;
    if !remaining.is_empty() {
        return Ok(SyncOutcome::Conflicts { files: remaining });
    }
    if path.join(".git").join("MERGE_HEAD").exists() {
        let out = run_git(path, &["commit", "--no-edit"])?;
        if !out.status.success() {
            return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
        }
    }
    let branch = current_branch(path)?;
    let out = run_git(path, &["push", "-u", "origin", &branch])?;
    if !out.status.success() {
        return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
    }
    Ok(SyncOutcome::Ok { pulled: true })
}

/// Abandon the in-progress merge entirely: local commits stay, remote changes
/// are un-applied, the working tree returns to the pre-pull state.
pub fn abort_merge(path: &Path) -> Result<()> {
    let out = run_git(path, &["merge", "--abort"])?;
    if !out.status.success() {
        return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
    }
    Ok(())
}

pub fn list_agent_branches(repo: &Repository) -> Result<Vec<AgentBranch>> {
    let mut branches = Vec::new();

    for branch in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = branch?;
        let name = branch.name()?.unwrap_or("").to_string();
        if !name.starts_with("agent/") {
            continue;
        }

        let description = name
            .strip_prefix("agent/")
            .unwrap_or(&name)
            .replace('-', " ");

        let tip = branch.get().peel_to_commit()?;
        let head = repo.head()?.peel_to_commit()?;
        let (commit_count, _) = repo.graph_ahead_behind(tip.id(), head.id())?;

        branches.push(AgentBranch { name, description, commit_count });
    }

    Ok(branches)
}

/// Merge an agent branch into the current branch and delete the agent branch.
pub fn apply_agent_branch(repo: &Repository, branch_name: &str) -> Result<()> {
    let branch = repo.find_branch(branch_name, BranchType::Local)?;
    let annotated = repo.reference_to_annotated_commit(branch.get())?;

    let (analysis, _) = repo.merge_analysis(&[&annotated])?;

    if analysis.is_fast_forward() {
        let refname = format!("refs/heads/{}", branch_name);
        let target_oid = repo.find_reference(&refname)?.target()
            .ok_or_else(|| AppError::Other("branch has no target".into()))?;
        let head_ref = repo.head()?;
        let head_refname = head_ref.name()
            .ok_or_else(|| AppError::Other("HEAD has no name".into()))?
            .to_string();
        repo.find_reference(&head_refname)?
            .set_target(target_oid, "fast-forward merge")?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
    } else if analysis.is_normal() {
        repo.merge(&[&annotated], None, None)?;
        let sig = repo.signature()?;
        let mut index = repo.index()?;
        if index.has_conflicts() {
            return Err(AppError::Other("merge conflicts — resolve manually".into()));
        }
        let oid = index.write_tree()?;
        let tree = repo.find_tree(oid)?;
        let head_commit = repo.head()?.peel_to_commit()?;
        let branch_commit = branch.get().peel_to_commit()?;
        let msg = format!("Merge agent branch '{}'", branch_name);
        repo.commit(Some("HEAD"), &sig, &sig, &msg, &tree, &[&head_commit, &branch_commit])?;
        repo.cleanup_state()?;
    }

    // Delete the agent branch after applying
    repo.find_branch(branch_name, BranchType::Local)?.delete()?;
    Ok(())
}

pub fn discard_agent_branch(repo: &Repository, branch_name: &str) -> Result<()> {
    repo.find_branch(branch_name, BranchType::Local)?.delete()?;
    Ok(())
}

// ── Tests: the multi-user sync contract ─────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sh(dir: &Path, args: &[&str]) {
        let out = std::process::Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(out.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
    }

    /// A bare origin plus two clones with distinct identities — the 3-person
    /// company setup in miniature.
    fn two_user_setup(tag: &str) -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
        let base = std::env::temp_dir().join(format!("cortex-sync-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        let origin = base.join("origin.git");
        std::fs::create_dir_all(&origin).unwrap();
        sh(&origin, &["init", "--bare", "--initial-branch=main", "."]);

        let mk_clone = |name: &str, user: &str| {
            let dir = base.join(name);
            sh(&base, &["clone", origin.to_str().unwrap(), name]);
            sh(&dir, &["config", "user.name", user]);
            sh(&dir, &["config", "user.email", &format!("{user}@test.local")]);
            sh(&dir, &["checkout", "-b", "main"]);
            dir
        };
        let a = mk_clone("alice", "alice");
        let b = mk_clone("bob", "bob");
        (base, a, b)
    }

    fn write(dir: &Path, rel: &str, content: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }

    fn read(dir: &Path, rel: &str) -> String {
        std::fs::read_to_string(dir.join(rel)).unwrap()
    }

    #[test]
    fn sync_round_trip_and_conflict_resolution() {
        let (base, alice, bob) = two_user_setup("flow");

        // Alice writes and syncs — auto-commits dirty work, pushes, sets upstream.
        write(&alice, "notes/plan.md", "# Plan\nshared line\n");
        match sync_vault(&alice).unwrap() {
            SyncOutcome::Ok { pulled } => assert!(!pulled, "nothing to pull on first push"),
            other => panic!("expected clean sync, got {other:?}"),
        }

        // Bob syncs — pulls Alice's note.
        match sync_vault(&bob).unwrap() {
            SyncOutcome::Ok { pulled } => assert!(pulled, "bob should have pulled"),
            other => panic!("expected clean sync, got {other:?}"),
        }
        assert_eq!(read(&bob, "notes/plan.md"), "# Plan\nshared line\n");

        // Both edit the same line; Alice syncs first.
        write(&alice, "notes/plan.md", "# Plan\nalice version\n");
        assert!(matches!(sync_vault(&alice).unwrap(), SyncOutcome::Ok { .. }));

        write(&bob, "notes/plan.md", "# Plan\nbob version\n");
        let files = match sync_vault(&bob).unwrap() {
            SyncOutcome::Conflicts { files } => files,
            other => panic!("expected conflicts, got {other:?}"),
        };
        assert_eq!(files, vec!["notes/plan.md"]);
        // The file holds standard markers (the documented strategy) and the repo
        // reports the same conflicts when asked again (e.g. after an app restart).
        assert!(read(&bob, "notes/plan.md").contains("<<<<<<<"));
        assert_eq!(list_conflicts(&bob).unwrap(), vec!["notes/plan.md"]);
        // Re-running sync mid-merge surfaces the same state instead of stacking pulls.
        assert!(matches!(sync_vault(&bob).unwrap(), SyncOutcome::Conflicts { .. }));

        // Bob takes Alice's version, completes the merge, and pushes.
        resolve_conflict(&bob, "notes/plan.md", "theirs").unwrap();
        assert!(matches!(complete_merge(&bob).unwrap(), SyncOutcome::Ok { .. }));
        assert_eq!(read(&bob, "notes/plan.md"), "# Plan\nalice version\n");

        // Alice syncs and everyone has converged.
        assert!(matches!(sync_vault(&alice).unwrap(), SyncOutcome::Ok { .. }));
        assert_eq!(read(&alice, "notes/plan.md"), "# Plan\nalice version\n");

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn abort_merge_restores_pre_pull_state() {
        let (base, alice, bob) = two_user_setup("abort");

        write(&alice, "n.md", "base\n");
        sync_vault(&alice).unwrap();
        sync_vault(&bob).unwrap();

        write(&alice, "n.md", "alice\n");
        sync_vault(&alice).unwrap();
        write(&bob, "n.md", "bob\n");
        assert!(matches!(sync_vault(&bob).unwrap(), SyncOutcome::Conflicts { .. }));

        abort_merge(&bob).unwrap();
        // Bob's own committed version is back, no markers, no merge state.
        assert_eq!(read(&bob, "n.md"), "bob\n");
        assert!(list_conflicts(&bob).unwrap().is_empty());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn stage_all_and_commit_skips_empty_commits() {
        let dir = std::env::temp_dir().join(format!("cortex-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        sh(&dir, &["init", "--initial-branch=main", "."]);
        sh(&dir, &["config", "user.name", "t"]);
        sh(&dir, &["config", "user.email", "t@t"]);
        std::fs::write(dir.join("a.md"), "x").unwrap();

        let repo = Repository::open(&dir).unwrap();
        stage_all_and_commit(&repo, "first").unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap().id();

        // Nothing changed — no new commit.
        stage_all_and_commit(&repo, "noop").unwrap();
        assert_eq!(repo.head().unwrap().peel_to_commit().unwrap().id(), head);

        std::fs::remove_dir_all(&dir).ok();
    }
}
