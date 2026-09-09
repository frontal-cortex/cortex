//! Remote and merge operations behind one trait, so the sync contract
//! (`docs/MOBILE.md`, Phase 1) has two interchangeable backends:
//!
//! - [`ShellRemote`] — the desktop path: shells out to the system `git`
//!   binary, so SSH agents, credential helpers and OS keychains keep working.
//!   This is the original `git.rs` code, unchanged.
//! - [`Git2Remote`] — the in-process path for mobile, where there is no `git`
//!   binary and no subprocesses: libgit2 via the `git2` crate, HTTPS + token
//!   credentials, the same `<<<<<<<` markers on conflict, the same
//!   `MERGE_HEAD` state the resolution UI already knows.
//!
//! [`default_remote`] picks the backend: shell on desktop, git2 on iOS and
//! Android, with `CORTEX_GIT_TRANSPORT=git2|shell` as a runtime override for
//! trying the in-process path on a desktop. Everything the app, CLI and MCP
//! call goes through `git::sync_vault` & co., which delegate here — so the
//! choice is made in exactly one place.

use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};

use git2::{
    build::{CheckoutBuilder, RepoBuilder},
    BranchType, Cred, CredentialType, FetchOptions, Oid, PushOptions, RemoteCallbacks,
    Repository, RepositoryState,
};

use crate::error::{AppError, Result};
use crate::git::{get_status, signature, stage_all_and_commit, SyncOutcome};
use crate::members::CurrentUser;

/// Every operation that talks to a remote or drives a merge. `repo` is the
/// vault root (the working directory), never a bare path.
pub trait RemoteOps: Send + Sync {
    /// Clone `url` into `dest` (which must not exist yet).
    fn clone_to(&self, url: &str, dest: &Path) -> Result<()>;
    /// Files currently in the unmerged (conflicted) state.
    fn list_conflicts(&self, repo: &Path) -> Result<Vec<String>>;
    /// Full sync: commit dirty work, merge in the remote, push. Never leaves
    /// the repo in a broken state — a conflicted merge is surfaced
    /// (recoverable) and any other pull failure is rolled back.
    fn sync(&self, repo: &Path) -> Result<SyncOutcome>;
    /// Resolve one conflicted file: take `ours` / `theirs` wholesale, or
    /// `manual` when the user already edited the markers away. Stages the file.
    fn resolve_conflict(&self, repo: &Path, file: &str, side: &str) -> Result<()>;
    /// Conclude a fully-resolved merge: commit it and push. If conflicts
    /// remain, returns them instead.
    fn complete_merge(&self, repo: &Path) -> Result<SyncOutcome>;
    /// Abandon the in-progress merge: local commits stay, remote changes are
    /// un-applied, the working tree returns to the pre-pull state.
    fn abort_merge(&self, repo: &Path) -> Result<()>;
    /// Delete `origin`'s copy of a branch.
    fn delete_remote_branch(&self, repo: &Path, branch: &str) -> Result<()>;
    /// The configured git identity (repo config, falling back to global).
    fn identity(&self, repo: &Path) -> CurrentUser;
}

/// The backend for this build: shell on desktop, git2 on mobile.
/// `CORTEX_GIT_TRANSPORT=git2` (or `shell`) overrides it at runtime.
pub fn default_remote() -> Box<dyn RemoteOps> {
    match std::env::var("CORTEX_GIT_TRANSPORT").as_deref() {
        Ok("git2") => return Box::new(Git2Remote::from_env()),
        Ok("shell") => return Box::new(ShellRemote),
        _ => {}
    }
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        Box::new(Git2Remote::from_env())
    }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        Box::new(ShellRemote)
    }
}

/// Commit local work first: a merge needs a clean tree, and "share my
/// current state" is what the user means by sync.
fn commit_dirty_work(repo: &Repository) -> Result<()> {
    let st = get_status(repo)?;
    if !(st.staged.is_empty() && st.unstaged.is_empty() && st.untracked.is_empty()) {
        stage_all_and_commit(repo, "Auto-commit before sync")?;
    }
    Ok(())
}

// ── ShellRemote: system git ─────────────────────────────────────────────────────

/// Shells out to the system `git` binary — the desktop default.
pub struct ShellRemote;

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

fn shell_current_branch(path: &Path) -> Result<String> {
    // symbolic-ref (not rev-parse) so an unborn branch — a fresh vault with no
    // commits yet — still resolves to its name instead of erroring.
    git_stdout(path, &["symbolic-ref", "--short", "HEAD"])
        .map_err(|_| AppError::Other("Cannot sync: detached HEAD".into()))
}

fn shell_head_oid(path: &Path) -> String {
    git_stdout(path, &["rev-parse", "HEAD"]).unwrap_or_default()
}

fn shell_git_config(root: &Path, key: &str) -> Option<String> {
    let out = std::process::Command::new("git")
        .args(["config", key])
        .current_dir(root)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

impl RemoteOps for ShellRemote {
    fn clone_to(&self, url: &str, dest: &Path) -> Result<()> {
        let parent = dest.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(parent)?;
        let dest_s = dest.to_string_lossy().to_string();
        let out = run_git(parent, &["clone", url, &dest_s])?;
        if !out.status.success() {
            return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
        }
        Ok(())
    }

    fn list_conflicts(&self, path: &Path) -> Result<Vec<String>> {
        let out = git_stdout(path, &["diff", "--name-only", "--diff-filter=U"])?;
        Ok(out.lines().map(str::to_string).filter(|l| !l.is_empty()).collect())
    }

    fn sync(&self, path: &Path) -> Result<SyncOutcome> {
        // A merge already in progress (e.g. app restarted mid-resolution) takes
        // priority — surface it instead of stacking another pull on top.
        let existing = self.list_conflicts(path)?;
        if !existing.is_empty() {
            return Ok(SyncOutcome::Conflicts { files: existing });
        }

        {
            let repo = Repository::open(path)?;
            commit_dirty_work(&repo)?;
        }

        let branch = shell_current_branch(path)?;
        let before = shell_head_oid(path);

        let out = run_git(path, &["pull", "--no-rebase", "--no-edit", "origin", &branch])?;
        if !out.status.success() {
            let conflicts = self.list_conflicts(path)?;
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
        let pulled = shell_head_oid(path) != before;

        // `-u` keeps the upstream set so ahead/behind tracking works from the start.
        let out = run_git(path, &["push", "-u", "origin", &branch])?;
        if !out.status.success() {
            return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
        }

        Ok(SyncOutcome::Ok { pulled })
    }

    fn resolve_conflict(&self, path: &Path, file: &str, side: &str) -> Result<()> {
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

    fn complete_merge(&self, path: &Path) -> Result<SyncOutcome> {
        let remaining = self.list_conflicts(path)?;
        if !remaining.is_empty() {
            return Ok(SyncOutcome::Conflicts { files: remaining });
        }
        if path.join(".git").join("MERGE_HEAD").exists() {
            let out = run_git(path, &["commit", "--no-edit"])?;
            if !out.status.success() {
                return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
            }
        }
        let branch = shell_current_branch(path)?;
        let out = run_git(path, &["push", "-u", "origin", &branch])?;
        if !out.status.success() {
            return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
        }
        Ok(SyncOutcome::Ok { pulled: true })
    }

    fn abort_merge(&self, path: &Path) -> Result<()> {
        let out = run_git(path, &["merge", "--abort"])?;
        if !out.status.success() {
            return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
        }
        Ok(())
    }

    fn delete_remote_branch(&self, path: &Path, branch: &str) -> Result<()> {
        let out = run_git(path, &["push", "origin", "--delete", branch])?;
        if !out.status.success() {
            return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).to_string()));
        }
        Ok(())
    }

    fn identity(&self, root: &Path) -> CurrentUser {
        CurrentUser {
            name: shell_git_config(root, "user.name").unwrap_or_default(),
            email: shell_git_config(root, "user.email").unwrap_or_default(),
        }
    }
}

// ── Git2Remote: libgit2 in-process ──────────────────────────────────────────────

/// In-process git via libgit2. HTTPS with a token (any username + a personal
/// access token) or, without one, whatever the credential helper / default
/// credentials offer. SSH is out of scope (`docs/MOBILE.md`).
#[derive(Debug, Clone, Default)]
pub struct Git2Remote {
    username: Option<String>,
    token: Option<String>,
}

impl Git2Remote {
    /// No explicit token: credential helpers / anonymous only.
    pub fn new() -> Self {
        Self::default()
    }

    /// HTTPS with a personal access token. GitHub and Gitea accept any
    /// non-empty username with a PAT; `git` is the conventional one.
    pub fn with_token(username: impl Into<String>, token: impl Into<String>) -> Self {
        Self { username: Some(username.into()), token: Some(token.into()) }
    }

    /// Token from `CORTEX_GIT_TOKEN` (and `CORTEX_GIT_USERNAME`, default `git`),
    /// so the in-process path can be tried on a desktop before the mobile
    /// keychain (Phase 2) exists.
    pub fn from_env() -> Self {
        match std::env::var("CORTEX_GIT_TOKEN").ok().filter(|t| !t.trim().is_empty()) {
            Some(token) => {
                let user = std::env::var("CORTEX_GIT_USERNAME").unwrap_or_else(|_| "git".into());
                Self::with_token(user, token)
            }
            None => Self::new(),
        }
    }

    fn callbacks(&self) -> RemoteCallbacks<'_> {
        let mut cb = RemoteCallbacks::new();
        // libgit2 re-asks after a rejected credential; without a cap that is
        // an infinite loop for a bad token.
        let attempts = Cell::new(0u8);
        cb.credentials(move |url, username_from_url, allowed| {
            let n = attempts.get();
            attempts.set(n + 1);
            if n >= 2 {
                return Err(git2::Error::from_str("Authentication failed for this remote"));
            }
            if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
                if let Some(token) = &self.token {
                    let user = self.username.as_deref().or(username_from_url).unwrap_or("git");
                    return Cred::userpass_plaintext(user, token);
                }
                if let Ok(cfg) = git2::Config::open_default() {
                    if let Ok(cred) = Cred::credential_helper(&cfg, url, username_from_url) {
                        return Ok(cred);
                    }
                }
            }
            if allowed.contains(CredentialType::DEFAULT) {
                return Cred::default();
            }
            Err(git2::Error::from_str(
                "No credentials for this remote (HTTPS with a token is the supported form)",
            ))
        });
        cb
    }

    /// Fetch `branch` from origin into `refs/remotes/origin/<branch>`; `None`
    /// when the remote does not have the branch yet (nothing to pull).
    fn fetch_branch(&self, repo: &Repository, branch: &str) -> Result<Option<Oid>> {
        let mut remote = repo
            .find_remote("origin")
            .map_err(|_| AppError::Other("No remote named 'origin'".into()))?;
        // libgit2 fetches nothing, silently, when the refspec matches no remote
        // ref — so fetch into a private ref that is cleared first: its
        // presence afterwards is the "remote has this branch" signal.
        // (`Remote::list` would tell us directly, but git2 0.19 mishandles an
        // empty remote there.)
        let probe = format!("refs/cortex/sync/{branch}");
        if let Ok(mut r) = repo.find_reference(&probe) {
            r.delete()?;
        }
        let mut fo = FetchOptions::new();
        fo.remote_callbacks(self.callbacks());
        let refspec = format!("+refs/heads/{branch}:{probe}");
        remote.fetch(&[refspec.as_str()], Some(&mut fo), None)?;
        let Ok(mut fetched) = repo.find_reference(&probe) else {
            return Ok(None);
        };
        let oid = fetched
            .target()
            .ok_or_else(|| AppError::Other("origin branch has no target".into()))?;
        fetched.delete()?;
        repo.reference(
            &format!("refs/remotes/origin/{branch}"),
            oid,
            true,
            &format!("fetch origin {branch}"),
        )?;
        Ok(Some(oid))
    }

    /// Merge the fetched tip into HEAD. `Some(files)` = conflicts (the repo
    /// is now mid-merge, markers on disk); `None` = merged (or nothing to do).
    fn merge_fetched(&self, repo: &Repository, branch: &str, theirs: Oid) -> Result<Option<Vec<String>>> {
        let remote_ref = repo.find_reference(&format!("refs/remotes/origin/{branch}"))?;
        let annotated = repo.reference_to_annotated_commit(&remote_ref)?;
        let (analysis, _) = repo.merge_analysis(&[&annotated])?;
        let refname = format!("refs/heads/{branch}");

        if analysis.is_up_to_date() {
            return Ok(None);
        }
        if analysis.is_unborn() || analysis.is_fast_forward() {
            let commit = repo.find_commit(theirs)?;
            repo.checkout_tree(commit.as_object(), Some(CheckoutBuilder::new().safe()))?;
            repo.reference(&refname, theirs, true, &format!("sync: fast-forward to origin/{branch}"))?;
            return Ok(None);
        }

        // A real merge. Like git, remember where HEAD was (ORIG_HEAD); HEAD
        // itself does not move until the merge is committed, which is what
        // `abort_merge` relies on.
        if let Some(head) = head_oid(repo) {
            std::fs::write(repo.path().join("ORIG_HEAD"), format!("{head}\n"))?;
        }
        let mut co = CheckoutBuilder::new();
        co.safe()
            .allow_conflicts(true)
            .conflict_style_merge(true)
            .our_label("HEAD")
            .their_label(&format!("origin/{branch}"));
        repo.merge(&[&annotated], None, Some(&mut co))?;

        let conflicts = index_conflicts(repo)?;
        if !conflicts.is_empty() {
            return Ok(Some(conflicts));
        }
        commit_merge(repo, branch)?;
        Ok(None)
    }

    fn push_branch(&self, repo: &Repository, branch: &str) -> Result<()> {
        let mut remote = repo
            .find_remote("origin")
            .map_err(|_| AppError::Other("No remote named 'origin'".into()))?;
        // libgit2 reports a rejected ref (e.g. non-fast-forward) through this
        // callback rather than as an error from `push`.
        let rejected: RefCell<Option<String>> = RefCell::new(None);
        let mut cb = self.callbacks();
        cb.push_update_reference(|refname, status| {
            if let Some(msg) = status {
                *rejected.borrow_mut() = Some(format!("{refname}: {msg}"));
            }
            Ok(())
        });
        let mut po = PushOptions::new();
        po.remote_callbacks(cb);
        let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
        remote.push(&[refspec.as_str()], Some(&mut po))?;
        if let Some(msg) = rejected.borrow().clone() {
            return Err(AppError::Other(format!("Push rejected — {msg}")));
        }
        // `-u`: keep the upstream set so ahead/behind tracking works from the start.
        if let Ok(mut b) = repo.find_branch(branch, BranchType::Local) {
            let _ = b.set_upstream(Some(&format!("origin/{branch}")));
        }
        Ok(())
    }
}

/// The checked-out branch name, even when unborn (no commits yet).
fn current_branch(repo: &Repository) -> Result<String> {
    let head = repo.find_reference("HEAD")?;
    match head.symbolic_target() {
        Some(target) => Ok(target.strip_prefix("refs/heads/").unwrap_or(target).to_string()),
        None => Err(AppError::Other("Cannot sync: detached HEAD".into())),
    }
}

fn head_oid(repo: &Repository) -> Option<Oid> {
    repo.head().ok().and_then(|h| h.target())
}

/// Conflicted paths from the index — the git2 equivalent of
/// `git diff --name-only --diff-filter=U` (index order, so sorted by path).
fn index_conflicts(repo: &Repository) -> Result<Vec<String>> {
    let index = repo.index()?;
    if !index.has_conflicts() {
        return Ok(vec![]);
    }
    let mut out: Vec<String> = Vec::new();
    for conflict in index.conflicts()? {
        let conflict = conflict?;
        let entry = conflict.our.as_ref().or(conflict.their.as_ref()).or(conflict.ancestor.as_ref());
        if let Some(e) = entry {
            let path = String::from_utf8_lossy(&e.path).to_string();
            if !out.contains(&path) {
                out.push(path);
            }
        }
    }
    Ok(out)
}

/// Turn the resolved index into the merge commit (HEAD + every MERGE_HEAD as
/// parents) and leave the merge state — what `git commit --no-edit` does.
fn commit_merge(repo: &Repository, branch: &str) -> Result<()> {
    let mut index = repo.index()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let head = repo.head()?.peel_to_commit()?;
    let mut parents = vec![head];
    let merge_heads = std::fs::read_to_string(repo.path().join("MERGE_HEAD")).unwrap_or_default();
    for line in merge_heads.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let oid = Oid::from_str(line)?;
        parents.push(repo.find_commit(oid)?);
    }
    let parents: Vec<&git2::Commit> = parents.iter().collect();
    // MERGE_MSG is what git (and libgit2) prepared; honour an edited one.
    let message = std::fs::read_to_string(repo.path().join("MERGE_MSG"))
        .ok()
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| format!("Merge remote-tracking branch 'origin/{branch}'"));
    let sig = signature(repo)?;
    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)?;
    repo.cleanup_state()?;
    Ok(())
}

fn write_blob(repo: &Repository, dest: &Path, entry: &git2::IndexEntry) -> Result<()> {
    let blob = repo.find_blob(entry.id)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(dest, blob.content())?;
    #[cfg(unix)]
    if entry.mode == 0o100755 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dest, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

impl RemoteOps for Git2Remote {
    fn clone_to(&self, url: &str, dest: &Path) -> Result<()> {
        let mut fo = FetchOptions::new();
        fo.remote_callbacks(self.callbacks());
        let mut builder = RepoBuilder::new();
        builder.fetch_options(fo);
        builder.clone(url, dest)?;
        Ok(())
    }

    fn list_conflicts(&self, path: &Path) -> Result<Vec<String>> {
        index_conflicts(&Repository::open(path)?)
    }

    fn sync(&self, path: &Path) -> Result<SyncOutcome> {
        let repo = Repository::open(path)?;
        let existing = index_conflicts(&repo)?;
        if !existing.is_empty() {
            return Ok(SyncOutcome::Conflicts { files: existing });
        }
        commit_dirty_work(&repo)?;

        let branch = current_branch(&repo)?;
        let before = head_oid(&repo);

        if let Some(theirs) = self.fetch_branch(&repo, &branch)? {
            match self.merge_fetched(&repo, &branch, theirs) {
                Ok(Some(files)) => return Ok(SyncOutcome::Conflicts { files }),
                Ok(None) => {}
                Err(e) => {
                    // Anything but a conflict: restore a clean state.
                    if repo.state() == RepositoryState::Merge {
                        let _ = self.abort_merge(path);
                    }
                    return Err(e);
                }
            }
        }
        let pulled = head_oid(&repo) != before;

        self.push_branch(&repo, &branch)?;
        Ok(SyncOutcome::Ok { pulled })
    }

    fn resolve_conflict(&self, path: &Path, file: &str, side: &str) -> Result<()> {
        let repo = Repository::open(path)?;
        let workdir = repo.workdir().ok_or_else(|| AppError::Other("Bare repository".into()))?;
        let rel = Path::new(file);
        let abs = workdir.join(rel);
        let mut index = repo.index()?;
        match side {
            "ours" | "theirs" => {
                let conflict = {
                    let mut found = None;
                    for c in index.conflicts()? {
                        let c = c?;
                        let p = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref());
                        if p.map(|e| e.path.as_slice()) == Some(file.as_bytes()) {
                            found = Some(c);
                            break;
                        }
                    }
                    found.ok_or_else(|| AppError::Other(format!("'{file}' is not conflicted")))?
                };
                let chosen = if side == "ours" { conflict.our } else { conflict.their };
                match chosen {
                    Some(entry) => {
                        write_blob(&repo, &abs, &entry)?;
                        index.add_path(rel)?;
                    }
                    // That side deleted the file: resolving to it removes it.
                    None => {
                        if abs.exists() {
                            std::fs::remove_file(&abs)?;
                        }
                        index.remove_path(rel)?;
                    }
                }
            }
            "manual" => {
                if abs.exists() {
                    index.add_path(rel)?;
                } else {
                    index.remove_path(rel)?;
                }
            }
            other => return Err(AppError::Other(format!("Unknown resolution side '{other}'"))),
        }
        index.write()?;
        Ok(())
    }

    fn complete_merge(&self, path: &Path) -> Result<SyncOutcome> {
        let repo = Repository::open(path)?;
        let remaining = index_conflicts(&repo)?;
        if !remaining.is_empty() {
            return Ok(SyncOutcome::Conflicts { files: remaining });
        }
        let branch = current_branch(&repo)?;
        if repo.state() == RepositoryState::Merge {
            commit_merge(&repo, &branch)?;
        }
        self.push_branch(&repo, &branch)?;
        Ok(SyncOutcome::Ok { pulled: true })
    }

    fn abort_merge(&self, path: &Path) -> Result<()> {
        let repo = Repository::open(path)?;
        if repo.state() != RepositoryState::Merge {
            return Err(AppError::Other("There is no merge to abort (MERGE_HEAD missing)".into()));
        }
        // HEAD is the pre-merge commit: a merge never moves it until it is
        // committed. Only the paths the merge touched go back — like
        // `git merge --abort`, unrelated edits survive.
        let head = repo.head()?.peel_to_commit()?;
        let head_tree = head.tree()?;
        let mut index = repo.index()?;
        let mut paths: Vec<PathBuf> = repo
            .diff_tree_to_index(Some(&head_tree), Some(&index), None)?
            .deltas()
            .filter_map(|d| d.new_file().path().or(d.old_file().path()).map(Path::to_path_buf))
            .collect();
        paths.extend(index_conflicts(&repo)?.into_iter().map(PathBuf::from));
        paths.sort();
        paths.dedup();

        index.read_tree(&head_tree)?;
        index.write()?;
        if !paths.is_empty() {
            let mut co = CheckoutBuilder::new();
            co.force().remove_untracked(true);
            for p in &paths {
                co.path(p);
            }
            repo.checkout_tree(head.as_object(), Some(&mut co))?;
        }
        repo.cleanup_state()?;
        Ok(())
    }

    fn delete_remote_branch(&self, path: &Path, branch: &str) -> Result<()> {
        let repo = Repository::open(path)?;
        let mut remote = repo
            .find_remote("origin")
            .map_err(|_| AppError::Other("No remote named 'origin'".into()))?;
        let mut po = PushOptions::new();
        po.remote_callbacks(self.callbacks());
        let refspec = format!(":refs/heads/{branch}");
        remote.push(&[refspec.as_str()], Some(&mut po))?;
        Ok(())
    }

    fn identity(&self, root: &Path) -> CurrentUser {
        let get = |key: &str| -> Option<String> {
            let repo = Repository::open(root).ok()?;
            let value = repo.config().ok()?.get_string(key).ok()?;
            let value = value.trim().to_string();
            (!value.is_empty()).then_some(value)
        };
        CurrentUser {
            name: get("user.name").unwrap_or_default(),
            email: get("user.email").unwrap_or_default(),
        }
    }
}

// ── Tests: Git2Remote against a local bare repo, on desktop ─────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// A bare origin plus two clones with distinct identities, built with
    /// git2 only — no system git involved in the setup either.
    fn two_user_setup(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("cortex-git2-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        let origin = base.join("origin.git");
        let mut opts = git2::RepositoryInitOptions::new();
        opts.bare(true).initial_head("main");
        Repository::init_opts(&origin, &opts).unwrap();

        let remote = Git2Remote::new();
        let mk_clone = |name: &str, user: &str| {
            let dir = base.join(name);
            remote.clone_to(origin.to_str().unwrap(), &dir).unwrap();
            let repo = Repository::open(&dir).unwrap();
            repo.set_head("refs/heads/main").unwrap();
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", user).unwrap();
            cfg.set_str("user.email", &format!("{user}@test.local")).unwrap();
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

    fn head_parents(dir: &Path) -> usize {
        Repository::open(dir).unwrap().head().unwrap().peel_to_commit().unwrap().parent_count()
    }

    /// Alice and Bob both edit the same line; Alice wins the push, Bob is
    /// left mid-merge. Returns after Bob's conflicted sync.
    fn make_conflict(r: &dyn RemoteOps, alice: &Path, bob: &Path) -> Vec<String> {
        write(alice, "notes/plan.md", "# Plan\nshared line\n");
        assert!(matches!(r.sync(alice).unwrap(), SyncOutcome::Ok { pulled: false }));
        assert!(matches!(r.sync(bob).unwrap(), SyncOutcome::Ok { pulled: true }));
        assert_eq!(read(bob, "notes/plan.md"), "# Plan\nshared line\n");

        write(alice, "notes/plan.md", "# Plan\nalice version\n");
        write(alice, "notes/extra.md", "only alice\n");
        assert!(matches!(r.sync(alice).unwrap(), SyncOutcome::Ok { .. }));

        write(bob, "notes/plan.md", "# Plan\nbob version\n");
        match r.sync(bob).unwrap() {
            SyncOutcome::Conflicts { files } => files,
            other => panic!("expected conflicts, got {other:?}"),
        }
    }

    #[test]
    fn git2_clean_sync_round_trip() {
        let (base, alice, bob) = two_user_setup("clean");
        let r = Git2Remote::new();

        write(&alice, "notes/a.md", "from alice\n");
        assert!(matches!(r.sync(&alice).unwrap(), SyncOutcome::Ok { pulled: false }));
        assert!(matches!(r.sync(&bob).unwrap(), SyncOutcome::Ok { pulled: true }));
        assert_eq!(read(&bob, "notes/a.md"), "from alice\n");

        // Non-overlapping edits merge cleanly into a two-parent commit.
        write(&alice, "notes/a.md", "from alice, v2\n");
        assert!(matches!(r.sync(&alice).unwrap(), SyncOutcome::Ok { pulled: false }));
        write(&bob, "notes/b.md", "from bob\n");
        assert!(matches!(r.sync(&bob).unwrap(), SyncOutcome::Ok { pulled: true }));
        assert_eq!(read(&bob, "notes/a.md"), "from alice, v2\n");
        assert_eq!(head_parents(&bob), 2);
        assert_eq!(Repository::open(&bob).unwrap().state(), RepositoryState::Clean);

        // Alice fast-forwards to the merge and sees both.
        assert!(matches!(r.sync(&alice).unwrap(), SyncOutcome::Ok { pulled: true }));
        assert_eq!(read(&alice, "notes/b.md"), "from bob\n");
        // Upstream is set, so ahead/behind tracking works.
        let st = get_status(&Repository::open(&alice).unwrap()).unwrap();
        assert_eq!((st.ahead, st.behind), (0, 0));

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn git2_conflict_resolve_theirs_and_complete() {
        let (base, alice, bob) = two_user_setup("theirs");
        let r = Git2Remote::new();

        let files = make_conflict(&r, &alice, &bob);
        assert_eq!(files, vec!["notes/plan.md"]);
        let marked = read(&bob, "notes/plan.md");
        assert!(marked.contains("<<<<<<< HEAD"), "{marked}");
        assert!(marked.contains(">>>>>>> origin/main"), "{marked}");
        assert!(marked.contains("bob version") && marked.contains("alice version"));
        assert_eq!(Repository::open(&bob).unwrap().state(), RepositoryState::Merge);
        // The non-conflicting file from the merge is already on disk.
        assert_eq!(read(&bob, "notes/extra.md"), "only alice\n");
        // Asked again (app restart) the repo reports the same conflicts, and
        // the shell path reads the very same state from disk.
        assert_eq!(r.list_conflicts(&bob).unwrap(), vec!["notes/plan.md"]);
        assert_eq!(ShellRemote.list_conflicts(&bob).unwrap(), vec!["notes/plan.md"]);
        assert!(matches!(r.sync(&bob).unwrap(), SyncOutcome::Conflicts { .. }));
        // Completing with conflicts left just reports them.
        assert!(matches!(r.complete_merge(&bob).unwrap(), SyncOutcome::Conflicts { .. }));

        r.resolve_conflict(&bob, "notes/plan.md", "theirs").unwrap();
        assert_eq!(read(&bob, "notes/plan.md"), "# Plan\nalice version\n");
        assert!(r.list_conflicts(&bob).unwrap().is_empty());
        assert!(matches!(r.complete_merge(&bob).unwrap(), SyncOutcome::Ok { .. }));
        assert_eq!(head_parents(&bob), 2);
        assert_eq!(Repository::open(&bob).unwrap().state(), RepositoryState::Clean);

        assert!(matches!(r.sync(&alice).unwrap(), SyncOutcome::Ok { pulled: true }));
        assert_eq!(read(&alice, "notes/plan.md"), "# Plan\nalice version\n");

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn git2_conflict_resolve_ours_and_complete() {
        let (base, alice, bob) = two_user_setup("ours");
        let r = Git2Remote::new();

        make_conflict(&r, &alice, &bob);
        r.resolve_conflict(&bob, "notes/plan.md", "ours").unwrap();
        assert_eq!(read(&bob, "notes/plan.md"), "# Plan\nbob version\n");
        assert!(matches!(r.complete_merge(&bob).unwrap(), SyncOutcome::Ok { .. }));
        assert_eq!(head_parents(&bob), 2);

        // Alice gets Bob's decision, plus keeps her own unrelated file.
        assert!(matches!(r.sync(&alice).unwrap(), SyncOutcome::Ok { pulled: true }));
        assert_eq!(read(&alice, "notes/plan.md"), "# Plan\nbob version\n");
        assert_eq!(read(&alice, "notes/extra.md"), "only alice\n");

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn git2_manual_resolution_is_staged_as_is() {
        let (base, alice, bob) = two_user_setup("manual");
        let r = Git2Remote::new();

        make_conflict(&r, &alice, &bob);
        write(&bob, "notes/plan.md", "# Plan\nboth versions\n");
        r.resolve_conflict(&bob, "notes/plan.md", "manual").unwrap();
        assert!(r.list_conflicts(&bob).unwrap().is_empty());
        assert!(matches!(r.complete_merge(&bob).unwrap(), SyncOutcome::Ok { .. }));
        assert!(matches!(r.sync(&alice).unwrap(), SyncOutcome::Ok { pulled: true }));
        assert_eq!(read(&alice, "notes/plan.md"), "# Plan\nboth versions\n");

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn git2_abort_merge_restores_pre_pull_state() {
        let (base, alice, bob) = two_user_setup("abort");
        let r = Git2Remote::new();

        // The app's ignored cache must survive a merge and its abort.
        write(&bob, ".gitignore", ".brain/\n");
        write(&bob, ".brain/index.db", "cache");
        make_conflict(&r, &alice, &bob);
        let bob_repo = Repository::open(&bob).unwrap();
        let before = bob_repo.head().unwrap().target().unwrap();
        assert_eq!(read(&bob, ".brain/index.db"), "cache");

        r.abort_merge(&bob).unwrap();
        assert_eq!(read(&bob, ".brain/index.db"), "cache");
        // Bob's own committed version is back, no markers, no merge state, and
        // the file the merge brought in is gone again.
        assert_eq!(read(&bob, "notes/plan.md"), "# Plan\nbob version\n");
        assert!(!bob.join("notes/extra.md").exists());
        assert!(r.list_conflicts(&bob).unwrap().is_empty());
        assert_eq!(bob_repo.state(), RepositoryState::Clean);
        assert_eq!(bob_repo.head().unwrap().target().unwrap(), before);
        let st = get_status(&bob_repo).unwrap();
        assert!(st.staged.is_empty() && st.unstaged.is_empty() && st.untracked.is_empty(), "{st:?}");
        // Nothing to abort any more.
        assert!(r.abort_merge(&bob).is_err());

        std::fs::remove_dir_all(&base).ok();
    }

    /// The two backends leave the same state on disk: a merge started
    /// in-process is finished by system git, and vice versa.
    #[test]
    fn git2_and_shell_interoperate_mid_merge() {
        let (base, alice, bob) = two_user_setup("interop");
        let git2 = Git2Remote::new();
        let shell = ShellRemote;

        // git2 starts the merge; the shell resolves and commits it.
        make_conflict(&git2, &alice, &bob);
        assert_eq!(shell.list_conflicts(&bob).unwrap(), vec!["notes/plan.md"]);
        shell.resolve_conflict(&bob, "notes/plan.md", "theirs").unwrap();
        assert!(matches!(shell.complete_merge(&bob).unwrap(), SyncOutcome::Ok { .. }));
        assert_eq!(head_parents(&bob), 2);
        assert_eq!(Repository::open(&bob).unwrap().state(), RepositoryState::Clean);

        // The shell starts the next conflict; git2 aborts it.
        write(&alice, "notes/plan.md", "# Plan\nalice again\n");
        assert!(matches!(git2.sync(&alice).unwrap(), SyncOutcome::Ok { pulled: true }));
        write(&bob, "notes/plan.md", "# Plan\nbob again\n");
        assert!(matches!(shell.sync(&bob).unwrap(), SyncOutcome::Conflicts { .. }));
        assert_eq!(git2.list_conflicts(&bob).unwrap(), vec!["notes/plan.md"]);
        git2.abort_merge(&bob).unwrap();
        assert_eq!(read(&bob, "notes/plan.md"), "# Plan\nbob again\n");
        assert!(shell.list_conflicts(&bob).unwrap().is_empty());
        assert_eq!(Repository::open(&bob).unwrap().state(), RepositoryState::Clean);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn git2_identity_reads_repo_config() {
        let (base, alice, _bob) = two_user_setup("identity");
        let me = Git2Remote::new().identity(&alice);
        assert_eq!((me.name.as_str(), me.email.as_str()), ("alice", "alice@test.local"));
        std::fs::remove_dir_all(&base).ok();
    }
}
