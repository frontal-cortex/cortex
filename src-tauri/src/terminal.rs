//! Embedded terminal — a real PTY behind a side pane.
//!
//! The pane exists so the user can run interactive CLI tools (an AI agent
//! session, `git rebase -i`, a REPL) without leaving the vault. Those tools
//! need a controlling terminal — job control, raw mode, colour queries,
//! resize signals — so this is a pseudo-terminal running the user's shell,
//! not a command runner piping stdout. The frontend owns emulation (xterm.js);
//! this module only spawns, pumps bytes and resizes.
//!
//! Bytes cross the IPC boundary base64-encoded: terminal output is arbitrary
//! binary (partial UTF-8 sequences, control bytes) and a JSON string would
//! mangle it. One reader thread per session emits `terminal://data` chunks
//! and, on EOF, `terminal://exit`. A session that was killed on purpose is
//! removed before the reader notices EOF, so it emits no exit event and the
//! pane never shows "shell exited" for a shell it closed itself.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::vault::VaultState;
use cortex_core::error::{AppError, Result};

/// Emitted for every chunk the shell writes. Payload: [`TerminalData`].
pub const DATA_EVENT: &str = "terminal://data";
/// Emitted once when the shell exits on its own. Payload: [`TerminalExit`].
pub const EXIT_EVENT: &str = "terminal://exit";

/// Size of each read from the pty. Large enough that a screenful of colour
/// output is a handful of events, small enough that echo stays snappy.
const READ_CHUNK: usize = 16 * 1024;

/// Payload of `terminal://data`.
#[derive(Debug, Clone, Serialize)]
pub struct TerminalData {
    pub id: u32,
    /// Raw pty output, base64 (standard alphabet, padded).
    pub data: String,
}

/// Payload of `terminal://exit`.
#[derive(Debug, Clone, Serialize)]
pub struct TerminalExit {
    pub id: u32,
}

/// One live shell. The master handle is kept for `resize`; the writer is the
/// only one (portable-pty allows a single `take_writer`), so writes go
/// through the session under the state lock.
struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// All open terminal sessions, keyed by the id handed to the frontend.
#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<u32, Session>>,
    next_id: AtomicU32,
}

/// The user's shell. `$SHELL` is what they chose; the fallbacks are what
/// every machine of that kind is guaranteed to have.
fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
    } else {
        std::env::var("SHELL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "/bin/bash".into())
    }
}

/// Where the shell starts: the requested directory, else the open vault, else
/// home. A requested path that no longer exists falls through rather than
/// failing — an open terminal somewhere beats no terminal.
fn resolve_cwd(app: &AppHandle, requested: Option<String>) -> Option<PathBuf> {
    let requested = requested
        .map(PathBuf::from)
        .filter(|p| p.is_dir());
    if requested.is_some() {
        return requested;
    }
    let vault = app.state::<VaultState>().0.lock().unwrap().clone();
    if vault.as_deref().is_some_and(|p| p.is_dir()) {
        return vault;
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.max(1),
        rows: rows.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Start a shell in a new pty. Returns the session id used by every other
/// terminal command and carried on every event.
#[tauri::command]
pub fn terminal_spawn(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<u32> {
    let pair = native_pty_system()
        .openpty(pty_size(cols, rows))
        .map_err(|e| AppError::Other(format!("Failed to open pty: {e}")))?;

    let mut cmd = CommandBuilder::new(default_shell());
    // Advertise what xterm.js actually renders, whatever the app inherited.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if let Some(dir) = resolve_cwd(&app, cwd) {
        cmd.cwd(dir);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::Other(format!("Failed to start shell: {e}")))?;
    // Our copy of the slave must go, or the master never sees EOF when the
    // shell exits (we would be the last holder of the slave side).
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::Other(format!("Failed to read from pty: {e}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::Other(format!("Failed to write to pty: {e}")))?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.lock().unwrap().insert(
        id,
        Session {
            master: pair.master,
            writer,
            child,
        },
    );

    std::thread::spawn(move || pump(app, id, reader));
    Ok(id)
}

/// Send keystrokes (or pasted text) to the shell.
#[tauri::command]
pub fn terminal_write(state: State<'_, TerminalState>, id: u32, data: String) -> Result<()> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| AppError::Other(format!("No terminal session {id}")))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| AppError::Other(format!("Terminal write failed: {e}")))?;
    session
        .writer
        .flush()
        .map_err(|e| AppError::Other(format!("Terminal write failed: {e}")))
}

/// Tell the kernel (and so the shell, via SIGWINCH) the pane changed size.
#[tauri::command]
pub fn terminal_resize(state: State<'_, TerminalState>, id: u32, cols: u16, rows: u16) -> Result<()> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get(&id)
        .ok_or_else(|| AppError::Other(format!("No terminal session {id}")))?;
    session
        .master
        .resize(pty_size(cols, rows))
        .map_err(|e| AppError::Other(format!("Terminal resize failed: {e}")))
}

/// End a session: kill the shell and forget it. Idempotent — the pane calls
/// this on unmount whether or not the shell already exited.
#[tauri::command]
pub fn terminal_kill(state: State<'_, TerminalState>, id: u32) -> Result<()> {
    let removed = state.sessions.lock().unwrap().remove(&id);
    if let Some(mut session) = removed {
        let _ = session.child.kill();
        // Reap so a killed shell doesn't linger as a zombie for the app's life.
        let _ = session.child.wait();
    }
    Ok(())
}

/// Reader thread: forward pty output until the shell goes away.
fn pump(app: AppHandle, id: u32, mut reader: Box<dyn Read + Send>) {
    let mut buf = vec![0u8; READ_CHUNK];
    loop {
        // On Linux a closed slave surfaces as EIO rather than a clean 0-byte
        // read; either way the shell is gone.
        let n = match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        let payload = TerminalData {
            id,
            data: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf[..n]),
        };
        let _ = app.emit(DATA_EVENT, payload);
    }

    // Still registered means the shell exited by itself (not `terminal_kill`).
    let removed = app.state::<TerminalState>().sessions.lock().unwrap().remove(&id);
    if let Some(mut session) = removed {
        let _ = session.child.wait();
        let _ = app.emit(EXIT_EVENT, TerminalExit { id });
    }
}
