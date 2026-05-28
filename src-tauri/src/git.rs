use git2::{Repository, StatusOptions, BranchType};
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
