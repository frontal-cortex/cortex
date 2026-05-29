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
    let tree = repo.find_tree(oid)?;
    let sig = repo.signature()?;

    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
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
