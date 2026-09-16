//! One writer per vault.
//!
//! A long-lived host of a vault — the desktop app, `cortex serve` — indexes it,
//! follows it and auto-commits it. Two at once would race on the index and on
//! commits, so opening a vault takes `.brain/writer.lock` (`.brain/` is the
//! gitignored cache, so the lock never syncs anywhere). A second host refuses
//! with a message naming the first. A lock whose process is gone — a crash, a
//! power cut — is taken over. One-shot writers (`cortex set`, an editor, an
//! agent) are not hosts and never look at it; the watcher is how the host sees
//! what they did.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use cortex_core::error::{AppError, Result};

const FILE: &str = "writer.lock";

/// Who holds a vault.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Holder {
    pub pid: u32,
    pub host: String,
    /// What the holder is, for the refusal message: "the desktop app", "cortex serve".
    pub kind: String,
    /// Unix seconds.
    pub started: i64,
    /// Tells two locks of the same process apart, so releasing one cannot
    /// release the other's hold (reopening a vault within the same second).
    #[serde(default)]
    pub mark: u64,
}

/// A held lock. Dropping it releases the vault.
#[derive(Debug)]
pub struct WriterLock {
    path: PathBuf,
    holder: Holder,
}

impl WriterLock {
    /// Take `vault` for this process, or say who has it.
    pub fn acquire(vault: &Path, kind: &str) -> Result<WriterLock> {
        let dir = vault.join(".brain");
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(FILE);
        let me = Holder {
            pid: std::process::id(),
            host: hostname(),
            kind: kind.to_string(),
            started: chrono::Utc::now().timestamp(),
            mark: next_mark(),
        };

        // Two attempts: a lock can vanish between reading it and creating ours.
        for _ in 0..2 {
            if let Some(current) = read_holder(&path) {
                let ours = current.pid == me.pid && current.host == me.host;
                let stale = current.host == me.host && !alive(current.pid);
                if !ours && !stale {
                    return Err(AppError::Other(format!(
                        "This vault is already open in {} (process {} on {}). Close it there first, or open a different vault.",
                        current.kind, current.pid, current.host
                    )));
                }
                // Ours already, or left behind by a process that is gone.
                write_holder(&path, &me, false)?;
                return Ok(WriterLock { path, holder: me });
            }
            match write_holder(&path, &me, true) {
                Ok(()) => return Ok(WriterLock { path, holder: me }),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.into()),
            }
        }
        Err(AppError::Other("could not take the vault's writer lock".into()))
    }

    pub fn holder(&self) -> &Holder {
        &self.holder
    }
}

impl Drop for WriterLock {
    fn drop(&mut self) {
        // Only remove the file if it still names us.
        if read_holder(&self.path).as_ref() == Some(&self.holder) {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Who holds `vault`, if anyone.
pub fn holder_of(vault: &Path) -> Option<Holder> {
    read_holder(&vault.join(".brain").join(FILE))
}

fn read_holder(path: &Path) -> Option<Holder> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn write_holder(path: &Path, holder: &Holder, create_new: bool) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(holder).unwrap_or_default();
    if create_new {
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(path)?;
        f.write_all(json.as_bytes())
    } else {
        let tmp = path.with_extension("lock.tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(tmp, path)
    }
}

/// A number no other lock in this process shares.
fn next_mark() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

fn hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "localhost".into())
}

/// Whether a process with this id is running on this machine.
#[cfg(unix)]
fn alive(pid: u32) -> bool {
    // Signal 0 checks for existence without sending anything. EPERM means it
    // exists but belongs to someone else — still alive.
    let r = unsafe { libc::kill(pid as libc::pid_t, 0) };
    r == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// Without a cheap check, assume a recorded process is still running: a
/// refusal the user can resolve beats two writers.
#[cfg(not(unix))]
fn alive(_pid: u32) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cortex-lock-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn taking_and_dropping_the_lock() {
        let v = vault("take");
        let lock = WriterLock::acquire(&v, "the desktop app").unwrap();
        assert_eq!(holder_of(&v).unwrap().kind, "the desktop app");
        // The same process asking again is fine (reopening the same vault) —
        // and letting the first one go does not release the second's hold.
        let again = WriterLock::acquire(&v, "the desktop app").unwrap();
        drop(lock);
        assert!(holder_of(&v).is_some(), "the newer lock still holds the vault");
        drop(again);
        assert!(holder_of(&v).is_none(), "released on drop");
        let _ = std::fs::remove_dir_all(&v);
    }

    #[cfg(unix)]
    #[test]
    fn a_live_holder_refuses_and_a_dead_one_is_taken_over() {
        let v = vault("other");
        let path = v.join(".brain").join(FILE);
        std::fs::create_dir_all(v.join(".brain")).unwrap();
        // pid 1 is always running.
        let live = Holder { pid: 1, host: hostname(), kind: "cortex serve".into(), started: 0, mark: 0 };
        write_holder(&path, &live, true).unwrap();
        let err = WriterLock::acquire(&v, "the desktop app").unwrap_err().to_string();
        assert!(err.contains("already open in cortex serve"), "{err}");

        // A process id far above any real one has exited.
        let dead = Holder { pid: 4_000_000, host: hostname(), kind: "cortex serve".into(), started: 0, mark: 0 };
        write_holder(&path, &dead, false).unwrap();
        let lock = WriterLock::acquire(&v, "the desktop app").unwrap();
        assert_eq!(lock.holder().pid, std::process::id());
        drop(lock);
        let _ = std::fs::remove_dir_all(&v);
    }
}
