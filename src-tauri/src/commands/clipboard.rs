//! The system clipboard, read from the Rust side.
//!
//! WebKitGTK on Wayland does not always run its own paste command: Ctrl+V
//! reaches the page as a keydown and no `paste` event follows, for text and
//! images alike. When the editor sees that, it asks here. Only what the editor
//! can place is returned — an image if there is one, else plain text — read
//! with the display server's own tool (wl-clipboard on Wayland, xclip on X11),
//! so nothing else is linked in and nothing runs unless the user pressed paste.

use std::process::{Command, Stdio};

use cortex_core::error::{AppError, Result};

#[derive(serde::Serialize)]
pub struct ClipboardContent {
    /// "image", "text" or "none".
    pub kind: String,
    pub mime: String,
    pub data_base64: String,
}

const IMAGE_TYPES: [&str; 5] = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];
const TEXT_TYPES: [&str; 5] = ["text/plain;charset=utf-8", "text/plain", "UTF8_STRING", "STRING", "TEXT"];

fn run(cmd: &str, args: &[&str]) -> Option<Vec<u8>> {
    let out = Command::new(cmd).args(args).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    if out.status.success() { Some(out.stdout) } else { None }
}

#[derive(Clone, Copy)]
enum Backend { Wayland, X11 }

fn list_types() -> Option<(String, Backend)> {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        if let Some(o) = run("wl-paste", &["--list-types"]) {
            return Some((String::from_utf8_lossy(&o).into_owned(), Backend::Wayland));
        }
    }
    if let Some(o) = run("xclip", &["-selection", "clipboard", "-t", "TARGETS", "-o"]) {
        return Some((String::from_utf8_lossy(&o).into_owned(), Backend::X11));
    }
    None
}

fn read(backend: Backend, mime: &str) -> Option<Vec<u8>> {
    match backend {
        Backend::Wayland => run("wl-paste", &["--no-newline", "-t", mime]),
        Backend::X11 => run("xclip", &["-selection", "clipboard", "-t", mime, "-o"]),
    }
}

#[tauri::command]
pub fn read_clipboard() -> Result<ClipboardContent> {
    use base64::{engine::general_purpose, Engine as _};

    let Some((types, backend)) = list_types() else {
        return Err(AppError::Other(
            "no clipboard tool found — install wl-clipboard (Wayland) or xclip (X11)".into(),
        ));
    };
    let has = |m: &str| types.lines().any(|l| l.trim() == m);
    let content = |kind: &str, mime: &str, bytes: Vec<u8>| ClipboardContent {
        kind: kind.into(),
        mime: mime.into(),
        data_base64: general_purpose::STANDARD.encode(bytes),
    };
    if let Some(mime) = IMAGE_TYPES.iter().find(|m| has(m)) {
        if let Some(bytes) = read(backend, mime).filter(|b| !b.is_empty()) {
            return Ok(content("image", mime, bytes));
        }
    }
    for mime in TEXT_TYPES {
        if has(mime) {
            if let Some(bytes) = read(backend, mime).filter(|b| !b.is_empty()) {
                return Ok(content("text", "text/plain", bytes));
            }
        }
    }
    Ok(content("none", "", Vec::new()))
}
