//! Filesystem watcher — makes the app follow the vault, not the other way round.
//!
//! Files are the source of truth, so anything else that writes them (an agent
//! on a branch, `nvim`, a `git checkout`, a sync from another machine) must
//! show up in the index and the UI without the user alt-tabbing. Events are
//! debounced into one `vault://changed` emit per burst, and the index is
//! updated here (in Rust) before the frontend is told, so a refresh that
//! follows the event always sees current data.
//!
//! The app's own writes echo back through the watcher too. `SelfWrites` keeps
//! a content hash of what we last wrote per path; an event whose on-disk
//! content matches is our own echo and is dropped, so the editor never
//! remounts under the user's cursor because they typed.

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::vault::DbState;
use cortex_core::error::{AppError, Result};

/// Event name the frontend listens on.
pub const CHANGED_EVENT: &str = "vault://changed";

/// Bursts of events (a `git checkout` touching fifty files, an editor's
/// write-then-rename) are coalesced: emit after this much quiet…
const QUIET: Duration = Duration::from_millis(250);
/// …but never wait longer than this from the first event.
const MAX_LATENCY: Duration = Duration::from_millis(1000);

/// Content hashes of files the app itself last wrote, keyed by vault-relative
/// path. See module docs.
#[derive(Debug, Default)]
pub struct SelfWrites(pub Mutex<HashMap<String, u64>>);

/// The live watcher for the open vault. Replacing or clearing it drops the
/// previous watcher, which closes its channel and ends its worker thread.
#[derive(Default)]
pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

/// Payload of `vault://changed`. Paths are vault-relative.
#[derive(Debug, Default, Clone, Serialize)]
pub struct VaultChanged {
    /// Notes created or modified on disk (already re-indexed).
    pub notes: Vec<String>,
    /// Notes that no longer exist (already removed from the index).
    pub removed: Vec<String>,
    /// A directory appeared or disappeared.
    pub dirs: bool,
    /// Something under `.cortex/` changed (settings, schemas, members).
    pub config: bool,
    /// Git refs moved (a commit, a new `agent/*` branch, a merge).
    pub git: bool,
}

impl VaultChanged {
    fn is_empty(&self) -> bool {
        self.notes.is_empty() && self.removed.is_empty() && !self.dirs && !self.config && !self.git
    }
}

pub fn hash_content(content: &str) -> u64 {
    let mut h = DefaultHasher::new();
    content.hash(&mut h);
    h.finish()
}

/// Remember that the app wrote `content` to `rel`, so the resulting watcher
/// event is recognised as our own echo.
pub fn record_self_write(self_writes: &SelfWrites, rel: &str, content: &str) {
    self_writes
        .0
        .lock()
        .unwrap()
        .insert(rel.replace('\\', "/"), hash_content(content));
}

/// Start watching `root`, replacing any previous watcher.
pub fn start(app: &AppHandle, root: PathBuf) -> Result<()> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    })
    .map_err(|e| AppError::Other(format!("Watcher failed to start: {e}")))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| AppError::Other(format!("Watcher failed to watch vault: {e}")))?;

    app.state::<SelfWrites>().0.lock().unwrap().clear();
    *app.state::<WatcherState>().0.lock().unwrap() = Some(watcher);

    let app = app.clone();
    std::thread::spawn(move || run(app, root, rx));
    Ok(())
}

/// Stop watching (on vault close). Idempotent.
pub fn stop(app: &AppHandle) {
    *app.state::<WatcherState>().0.lock().unwrap() = None;
    app.state::<SelfWrites>().0.lock().unwrap().clear();
}

fn run(app: AppHandle, root: PathBuf, rx: mpsc::Receiver<notify::Event>) {
    loop {
        // Block for the first event of a burst; a closed channel means the
        // watcher was dropped and this thread is done.
        let first = match rx.recv() {
            Ok(e) => e,
            Err(_) => return,
        };
        let mut paths: HashSet<PathBuf> = HashSet::new();
        collect(&first, &mut paths);

        let deadline = Instant::now() + MAX_LATENCY;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match rx.recv_timeout(QUIET.min(remaining)) {
                Ok(event) => collect(&event, &mut paths),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }

        let payload = classify(&app, &root, paths);
        if !payload.is_empty() {
            let _ = app.emit(CHANGED_EVENT, payload);
        }
    }
}

fn collect(event: &notify::Event, into: &mut HashSet<PathBuf>) {
    // Reads (Access) and backend chatter (Other) never change content.
    if matches!(event.kind, EventKind::Access(_) | EventKind::Other) {
        return;
    }
    into.extend(event.paths.iter().cloned());
}

/// Sort a burst of changed paths into the payload, updating the index for
/// notes as we go. Paths under the cache, trash and git internals are ignored
/// (except the handful of git files that mean "refs moved").
fn classify(app: &AppHandle, root: &Path, paths: HashSet<PathBuf>) -> VaultChanged {
    let db_state = app.state::<DbState>();
    let self_writes = app.state::<SelfWrites>();
    let mut out = VaultChanged::default();

    for abs in paths {
        let Ok(rel_path) = abs.strip_prefix(root) else { continue };
        let rel = rel_path.to_string_lossy().replace('\\', "/");
        let top = rel_path
            .components()
            .next()
            .and_then(|c| c.as_os_str().to_str())
            .unwrap_or("");

        match top {
            ".brain" | ".trash" => continue,
            ".git" => {
                if is_git_state(&rel) {
                    out.git = true;
                }
                continue;
            }
            ".cortex" => {
                out.config = true;
                continue;
            }
            _ => {}
        }

        let is_md = rel_path.extension().and_then(|e| e.to_str()) == Some("md");
        if !is_md {
            // A folder created/removed — or a path that vanished and could
            // have been one. Assets don't need a refresh.
            if abs.is_dir() || (!abs.exists() && rel_path.extension().is_none()) {
                out.dirs = true;
            }
            continue;
        }

        if abs.is_file() {
            let Ok(content) = std::fs::read_to_string(&abs) else { continue };
            let ours = self_writes.0.lock().unwrap().get(&rel) == Some(&hash_content(&content));
            if ours {
                continue; // echo of write_note / create_note — already indexed
            }
            if let Some(db) = db_state.0.lock().unwrap().as_ref() {
                let _ = cortex_core::index::index_file(root, &abs, db);
            }
            out.notes.push(rel);
        } else {
            if let Some(db) = db_state.0.lock().unwrap().as_ref() {
                let _ = db.remove_note(&rel);
            }
            self_writes.0.lock().unwrap().remove(&rel);
            out.removed.push(rel);
        }
    }

    out.notes.sort();
    out.removed.sort();
    out
}

/// Git files whose change means the branch/commit picture moved. The index
/// and object store churn constantly and are deliberately not included.
fn is_git_state(rel: &str) -> bool {
    rel.starts_with(".git/refs/")
        || matches!(
            rel,
            ".git/HEAD" | ".git/packed-refs" | ".git/MERGE_HEAD" | ".git/ORIG_HEAD"
        )
}
