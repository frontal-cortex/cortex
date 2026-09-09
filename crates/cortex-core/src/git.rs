pub use git2::Repository;
use git2::{Sort, StatusOptions, BranchType};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use crate::error::{AppError, Result};
use crate::remote::default_remote;

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
    /// Always the bare branch name, `agent/<slug>`, even for a remote one.
    pub name: String,
    pub description: String,
    pub commit_count: usize,
    /// True when the proposal exists only on `origin` (an agent pushed it
    /// from elsewhere); applying it creates the local branch first.
    pub remote: bool,
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

// ── Authorship: who created and last edited a file, and when ──────────────────
//
// The source of the `created_time` / `created_by` / `edited_time` /
// `edited_by` property types. Nothing here is written to a note: the values
// are read from git history on every view run (one walk for a whole
// collection) and fall back to the file's mtime outside a repository.

/// When a file was first committed and last changed, and by whom. Times are
/// local `YYYY-MM-DDTHH:MM`; authors are git author names, empty when the
/// value came from the filesystem instead of a commit.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Authorship {
    pub created_at: String,
    pub created_by: String,
    pub edited_at: String,
    pub edited_by: String,
}

/// A unix timestamp as local `YYYY-MM-DDTHH:MM` — the same shape every
/// authorship value has, so filters can still compare it against a plain
/// `YYYY-MM-DD` (the engine trims the time when the other side is a day).
pub fn format_time(secs: i64) -> String {
    chrono::DateTime::from_timestamp(secs, 0)
        .map(|t| t.with_timezone(&chrono::Local).format("%Y-%m-%dT%H:%M").to_string())
        .unwrap_or_default()
}

fn mtime_of(abs: &Path) -> String {
    std::fs::metadata(abs).ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| format_time(d.as_secs() as i64))
        .unwrap_or_default()
}

/// Authorship for several vault-relative paths at once — one walk over the
/// history, not one per file. A commit that leaves the paths' common parent
/// directory untouched is skipped without looking at the paths. A file with
/// no commit (never committed, or no repository at all) gets its mtime for
/// both times and no author; a file with uncommitted changes gets its mtime
/// and the local git user as its last edit, since that edit is not in any
/// commit yet.
pub fn authorship(root: &Path, paths: &[String]) -> std::collections::HashMap<String, Authorship> {
    let mut out: std::collections::HashMap<String, Authorship> = std::collections::HashMap::new();
    if paths.is_empty() { return out; }
    let repo = Repository::open(root).ok();

    // (newest commit, oldest commit) per path, as (time, author).
    let mut hits: std::collections::HashMap<&str, (Option<(i64, String)>, Option<(i64, String)>)> = std::collections::HashMap::new();
    if let Some(repo) = &repo {
        // The directory every path shares, if any — the pruning key.
        let common: Option<&Path> = {
            let first = Path::new(&paths[0]).parent();
            first.filter(|d| paths.iter().all(|p| Path::new(p).parent() == Some(d)) && !d.as_os_str().is_empty())
        };
        if let Ok(mut walk) = repo.revwalk() {
            if walk.push_head().is_ok() && walk.set_sorting(Sort::TIME).is_ok() {
                for oid in walk.flatten() {
                    let Ok(commit) = repo.find_commit(oid) else { continue };
                    let Ok(tree) = commit.tree() else { continue };
                    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
                    if let Some(dir) = common {
                        let cur = tree.get_path(dir).ok().map(|e| e.id());
                        let prev = parent_tree.as_ref().and_then(|t| t.get_path(dir).ok().map(|e| e.id()));
                        if cur == prev { continue; }
                    }
                    let when = commit.time().seconds();
                    let who = commit.author().name().unwrap_or("").to_string();
                    for path in paths {
                        let target = Path::new(path);
                        let cur = tree.get_path(target).ok().map(|e| e.id());
                        let prev = parent_tree.as_ref().and_then(|t| t.get_path(target).ok().map(|e| e.id()));
                        if cur.is_some() && cur != prev {
                            let entry = hits.entry(path.as_str()).or_default();
                            if entry.0.is_none() { entry.0 = Some((when, who.clone())); }
                            entry.1 = Some((when, who.clone()));
                        }
                    }
                }
            }
        }
    }

    let local_user = repo.as_ref().and_then(|r| signature(r).ok()).and_then(|s| s.name().map(str::to_string)).unwrap_or_default();
    for path in paths {
        let abs = root.join(path);
        let mut a = Authorship::default();
        match hits.get(path.as_str()) {
            Some((Some(newest), Some(oldest))) => {
                a.created_at = format_time(oldest.0);
                a.created_by = oldest.1.clone();
                a.edited_at = format_time(newest.0);
                a.edited_by = newest.1.clone();
                // Uncommitted changes are the newest edit of all.
                let dirty = repo.as_ref().and_then(|r| r.status_file(Path::new(path)).ok())
                    .map(|st| st.intersects(git2::Status::WT_MODIFIED | git2::Status::INDEX_MODIFIED | git2::Status::WT_NEW | git2::Status::INDEX_NEW))
                    .unwrap_or(false);
                if dirty {
                    a.edited_at = mtime_of(&abs);
                    a.edited_by = local_user.clone();
                }
            }
            _ => {
                let m = mtime_of(&abs);
                a.created_at = m.clone();
                a.edited_at = m;
            }
        }
        out.insert(path.clone(), a);
    }
    out
}

/// Authorship of one file (the properties panel's read-only rows).
pub fn authorship_of(root: &Path, path: &str) -> Authorship {
    authorship(root, &[path.to_string()]).remove(path).unwrap_or_default()
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
    let patch = render_patch(&diff)?;

    Ok(CommitDiff { hash: short_hash, message, author, timestamp, patch })
}

fn render_patch(diff: &git2::Diff<'_>) -> Result<String> {
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
    Ok(patch)
}

/// What a proposal would change: the diff from its merge-base with HEAD to
/// its tip — i.e. exactly what applying it adds, whatever HEAD did since.
pub fn get_branch_diff(repo: &Repository, branch_name: &str) -> Result<CommitDiff> {
    let tip = find_agent_branch(repo, branch_name)?;
    let head = repo.head()?.peel_to_commit()?;
    let base = repo.find_commit(repo.merge_base(head.id(), tip.id())?)?;

    let short_hash = format!("{:.7}", tip.id());
    let message = tip.summary().unwrap_or("").to_string();
    let author = tip.author().name().unwrap_or("").to_string();
    let timestamp = tip.time().seconds() as u64;

    let diff = repo.diff_tree_to_tree(Some(&base.tree()?), Some(&tip.tree()?), None)?;
    let patch = render_patch(&diff)?;
    Ok(CommitDiff { hash: short_hash, message, author, timestamp, patch })
}

/// The tip of a proposal, local branch first, then `origin/<name>`.
fn find_agent_branch<'r>(repo: &'r Repository, branch_name: &str) -> Result<git2::Commit<'r>> {
    let branch = repo
        .find_branch(branch_name, BranchType::Local)
        .or_else(|_| repo.find_branch(&format!("origin/{branch_name}"), BranchType::Remote))
        .map_err(|_| AppError::Other(format!("No proposal named '{branch_name}'")))?;
    Ok(branch.get().peel_to_commit()?)
}

/// Open an existing repository (no init — the CLI never creates one silently).
pub fn open(vault_path: &Path) -> Result<Repository> {
    Repository::open(vault_path).map_err(AppError::Git)
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

/// Who a commit is from: the configured git identity, or — when the machine
/// has none — `<login> <login@hostname>`, the guess git itself used to make.
/// Without this, a fresh install would never commit (auto-commit is on by
/// default and `New vault` makes an initial commit), and the user would only
/// learn why from a buried error. Configuring `user.name` / `user.email`
/// takes over as soon as it exists; earlier commits keep the fallback.
pub fn signature(repo: &Repository) -> Result<git2::Signature<'static>> {
    if let Ok(sig) = repo.signature() {
        return Ok(sig);
    }
    let login = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "cortex".into());
    let host = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "localhost".into());
    Ok(git2::Signature::now(&login, &format!("{login}@{host}"))?)
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
    let sig = signature(repo)?;
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
// The remote + merge operations live behind `remote::RemoteOps`: on desktop
// they shell out to system git so SSH agents and credential helpers work; on
// mobile they run in-process via libgit2 (see `remote.rs`). Everything else
// uses git2 directly.

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

/// Files currently in the unmerged (conflicted) state.
pub fn list_conflicts(path: &Path) -> Result<Vec<String>> {
    default_remote().list_conflicts(path)
}

/// Full sync: commit dirty work, merge in the remote, push. Never leaves the
/// repo in a broken state — a conflicted merge is surfaced (recoverable), and
/// any other pull failure is rolled back.
pub fn sync_vault(path: &Path) -> Result<SyncOutcome> {
    default_remote().sync(path)
}

/// Resolve one conflicted file: take ours / theirs wholesale, or `manual` when
/// the user has already edited the markers away in the editor. Stages the file.
pub fn resolve_conflict(path: &Path, file: &str, side: &str) -> Result<()> {
    default_remote().resolve_conflict(path, file, side)
}

/// Conclude a fully-resolved merge: commit it and push. If conflicts remain,
/// returns them instead (the UI keeps the resolution flow open).
pub fn complete_merge(path: &Path) -> Result<SyncOutcome> {
    default_remote().complete_merge(path)
}

/// Abandon the in-progress merge entirely: local commits stay, remote changes
/// are un-applied, the working tree returns to the pre-pull state.
pub fn abort_merge(path: &Path) -> Result<()> {
    default_remote().abort_merge(path)
}

/// Pending proposals: every `agent/*` branch, local or on `origin`. A branch
/// that exists in both places is listed once, as local.
pub fn list_agent_branches(repo: &Repository) -> Result<Vec<AgentBranch>> {
    let head = repo.head()?.peel_to_commit()?;
    let mut branches = Vec::new();
    let mut seen = HashSet::new();

    for (kind, remote) in [(BranchType::Local, false), (BranchType::Remote, true)] {
        for branch in repo.branches(Some(kind))? {
            let (branch, _) = branch?;
            let full = branch.name()?.unwrap_or("").to_string();
            // Remote-tracking names carry the remote: "origin/agent/x".
            let name = if remote {
                match full.split_once('/') { Some((_, n)) => n.to_string(), None => continue }
            } else {
                full
            };
            if !name.starts_with("agent/") || !seen.insert(name.clone()) {
                continue;
            }

            let description = name
                .strip_prefix("agent/")
                .unwrap_or(&name)
                .replace('-', " ");

            let tip = branch.get().peel_to_commit()?;
            let (commit_count, _) = repo.graph_ahead_behind(tip.id(), head.id())?;

            branches.push(AgentBranch { name, description, commit_count, remote });
        }
    }

    Ok(branches)
}

/// Delete `origin`'s copy of a proposal, if it has one. Best effort — a
/// missing remote or no network just leaves it for the next sync to tidy.
fn delete_remote_branch(repo: &Repository, branch_name: &str) {
    if repo.find_branch(&format!("origin/{branch_name}"), BranchType::Remote).is_err() {
        return;
    }
    if let Some(dir) = repo.workdir() {
        let _ = default_remote().delete_remote_branch(dir, branch_name);
    }
}

/// Turn a proposal name into its branch slug: "Summarise week 36" → "summarise-week-36".
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in name.trim().chars() {
        if c.is_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    out.trim_end_matches('-').to_string()
}

/// Package working-tree changes as a proposal: a new `agent/<slug>` branch
/// with one commit on top of HEAD holding `paths` (or every change, with
/// `all`). Those paths are then restored to HEAD in the working tree, so the
/// current branch is left exactly as it was before the agent's edits — the
/// proposal lives only on its branch until the user applies it. Returns the
/// branch name.
pub fn propose(repo: &Repository, name: &str, message: &str, paths: &[String], all: bool) -> Result<String> {
    let slug = slugify(name);
    if slug.is_empty() {
        return Err(AppError::Other("Proposal name is empty".into()));
    }
    let branch = format!("agent/{slug}");
    if repo.find_branch(&branch, BranchType::Local).is_ok() {
        return Err(AppError::Other(format!("Proposal '{branch}' already exists — discard it or pick another name")));
    }
    if paths.is_empty() && !all {
        return Err(AppError::Other("Nothing selected: pass the changed paths, or --all for every change in the working tree".into()));
    }

    let head = repo.head()?.peel_to_commit()?;
    let head_tree = head.tree()?;
    let workdir = repo.workdir().ok_or_else(|| AppError::Other("Bare repository".into()))?;

    // Stage into the in-memory index only — it is never written back, so the
    // user's own staging area is untouched.
    let mut index = repo.index()?;
    index.read_tree(&head_tree)?;
    if all {
        index.add_all(["*"], git2::IndexAddOption::DEFAULT, None)?;
        index.update_all(["*"], None)?;
    } else {
        for p in paths {
            let rel = Path::new(p);
            if workdir.join(rel).exists() {
                index.add_path(rel)?;
            } else {
                index.remove_path(rel)?;
            }
        }
    }
    let tree_oid = index.write_tree()?;
    if tree_oid == head_tree.id() {
        return Err(AppError::Other("Nothing to propose: those paths match HEAD".into()));
    }
    let tree = repo.find_tree(tree_oid)?;
    let sig = repo
        .signature()
        .or_else(|_| git2::Signature::now("Cortex agent", "agent@cortex.local"))?;
    repo.commit(Some(&format!("refs/heads/{branch}")), &sig, &sig, message, &tree, &[&head])?;

    // Put the working tree back to HEAD for what we took; the proposal now
    // owns those edits. Ignored files (.brain/) are never touched.
    let mut co = git2::build::CheckoutBuilder::new();
    co.force().remove_untracked(true);
    if !all {
        for p in paths {
            co.path(p);
        }
    }
    repo.checkout_tree(head.as_object(), Some(&mut co))?;

    Ok(branch)
}

/// Merge a proposal into the current branch and delete it (locally and, if
/// it was pushed, on `origin`). A remote-only proposal gets a local branch
/// first so the merge machinery is the same either way.
pub fn apply_agent_branch(repo: &Repository, branch_name: &str) -> Result<()> {
    if repo.find_branch(branch_name, BranchType::Local).is_err() {
        let tip = find_agent_branch(repo, branch_name)?;
        repo.branch(branch_name, &tip, false)?;
    }
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
        let sig = signature(repo)?;
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
    delete_remote_branch(repo, branch_name);
    Ok(())
}

/// Drop a proposal without merging — local branch, remote copy, or both.
pub fn discard_agent_branch(repo: &Repository, branch_name: &str) -> Result<()> {
    let local = repo.find_branch(branch_name, BranchType::Local);
    let remote = repo.find_branch(&format!("origin/{branch_name}"), BranchType::Remote).is_ok();
    match local {
        Ok(mut b) => b.delete()?,
        Err(_) if remote => {}
        Err(_) => return Err(AppError::Other(format!("No proposal named '{branch_name}'"))),
    }
    delete_remote_branch(repo, branch_name);
    Ok(())
}

// ── Tests: the multi-user sync contract ─────────────────────────────────────────

#[cfg(test)]
pub(crate) mod tests {
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

    /// Commit `rel` with a fixed author and time, so authorship is deterministic.
    pub(crate) fn commit_as(repo: &Repository, rel: &str, text: &str, who: &str, secs: i64) {
        let root = repo.workdir().unwrap();
        let abs = root.join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(&abs, text).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(rel)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::new(who, &format!("{who}@test.local"), &git2::Time::new(secs, 0)).unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, &format!("edit {rel}"), &tree, &parents).unwrap();
    }

    #[test]
    fn authorship_reads_first_and_last_commit_with_mtime_fallbacks() {
        let dir = std::env::temp_dir().join(format!("cortex-authorship-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = Repository::init(&dir).unwrap();
        let t0 = 1_700_000_000;
        commit_as(&repo, "collections/tasks/a.md", "---\ntitle: A\n---\n", "alice", t0);
        commit_as(&repo, "collections/tasks/b.md", "---\ntitle: B\n---\n", "bob", t0 + 3600);
        commit_as(&repo, "notes/other.md", "unrelated", "carol", t0 + 7200);
        commit_as(&repo, "collections/tasks/a.md", "---\ntitle: A2\n---\n", "bob", t0 + 10_800);
        // Never committed: mtime stands in, no author.
        std::fs::write(dir.join("collections/tasks/c.md"), "---\ntitle: C\n---\n").unwrap();

        let paths: Vec<String> = ["a", "b", "c"].iter().map(|s| format!("collections/tasks/{s}.md")).collect();
        let got = authorship(&dir, &paths);
        let a = &got["collections/tasks/a.md"];
        assert_eq!((a.created_at.as_str(), a.created_by.as_str()), (format_time(t0).as_str(), "alice"));
        assert_eq!((a.edited_at.as_str(), a.edited_by.as_str()), (format_time(t0 + 10_800).as_str(), "bob"));
        let b = &got["collections/tasks/b.md"];
        assert_eq!(b.created_at, b.edited_at);
        assert_eq!((b.created_by.as_str(), b.edited_by.as_str()), ("bob", "bob"));
        let c = &got["collections/tasks/c.md"];
        assert!(c.created_by.is_empty() && c.edited_by.is_empty());
        assert!(!c.created_at.is_empty() && c.created_at == c.edited_at, "{c:?}");
        assert_eq!(format_time(t0).len(), 16, "YYYY-MM-DDTHH:MM");

        // An uncommitted change is the newest edit: mtime, local user.
        std::fs::write(dir.join("collections/tasks/b.md"), "---\ntitle: B changed\n---\n").unwrap();
        let b = authorship_of(&dir, "collections/tasks/b.md");
        assert_eq!(b.created_by, "bob");
        assert_ne!(b.edited_by, "bob");
        assert!(b.edited_at >= b.created_at);

        // No repository at all: both times from the filesystem.
        let plain = std::env::temp_dir().join(format!("cortex-authorship-plain-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&plain);
        std::fs::create_dir_all(plain.join("collections/x")).unwrap();
        std::fs::write(plain.join("collections/x/r.md"), "---\ntitle: R\n---\n").unwrap();
        let r = authorship_of(&plain, "collections/x/r.md");
        assert!(!r.created_at.is_empty() && r.created_at == r.edited_at && r.created_by.is_empty());
        assert_eq!(authorship_of(&plain, "collections/x/missing.md"), Authorship::default());

        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&plain).ok();
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
