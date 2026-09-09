//! Desktop palette — let the app wear the desktop's colours.
//!
//! A palette file is a flat TOML table of colour names → hex strings, plus a
//! `mode` of "light" or "dark". That is exactly Omarchy's `colors.toml`, but
//! nothing here is Omarchy-specific: point `theme_file` at any file in that
//! shape. The frontend maps the names onto design tokens (see `tokens.css`),
//! so this module only reads, follows and forwards.
//!
//! Following matters more than reading: a desktop theme switch should retint
//! the app live. Omarchy swaps a `current/theme` symlink, so we watch both the
//! file's directory (in-place edits) and its parent (the swap), re-read on any
//! event, and re-arm the watch so it tracks the new target.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use cortex_core::error::{AppError, Result};

pub const CHANGED_EVENT: &str = "theme://changed";


#[derive(Default)]
pub struct ThemeWatcher(pub Mutex<Option<RecommendedWatcher>>);

#[derive(Debug, Clone, Serialize)]
pub struct Palette {
    /// "light" | "dark"
    pub mode: String,
    /// The desktop theme's name when the palette file sits where Omarchy keeps
    /// it (`current/theme/colors.toml` beside `current/theme.name`) — lets the
    /// app know a palette by name, not only by its colours.
    pub name: Option<String>,
    /// Colour name → hex, e.g. `background` → `#282828`. Only string values
    /// are kept; anything else in the file is ignored.
    pub colors: BTreeMap<String, String>,
}

pub fn read_palette(path: &Path) -> Result<Palette> {
    let text = std::fs::read_to_string(path)?;
    let table: toml::Table = text
        .parse()
        .map_err(|e| AppError::Other(format!("Palette file is not valid TOML: {e}")))?;
    let mut colors = BTreeMap::new();
    let mut mode = "dark".to_string();
    for (key, value) in table {
        let Some(s) = value.as_str() else { continue };
        if key == "mode" {
            mode = s.to_string();
        } else if s.starts_with('#') {
            colors.insert(key, s.to_string());
        }
    }
    if colors.is_empty() {
        return Err(AppError::Other("Palette file contains no colours".into()));
    }
    Ok(Palette { mode, colors, name: theme_name(path) })
}

/// Omarchy writes the active theme's name to `current/theme.name`, next to the
/// `current/theme/` folder the palette lives in.
fn theme_name(palette: &Path) -> Option<String> {
    let name_file = palette.parent()?.parent()?.join("theme.name");
    let name = std::fs::read_to_string(name_file).ok()?.trim().to_string();
    (!name.is_empty()).then_some(name)
}

#[cfg(test)]
mod name_tests {
    use super::*;

    #[test]
    fn a_palette_beside_theme_name_knows_its_theme() {
        let dir = std::env::temp_dir().join(format!("cortex-theme-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("current/theme")).unwrap();
        std::fs::write(dir.join("current/theme/colors.toml"), "mode = \"dark\"\naccent = \"#7daea3\"\nbackground = \"#282828\"\n").unwrap();
        assert_eq!(read_palette(&dir.join("current/theme/colors.toml")).unwrap().name, None);
        std::fs::write(dir.join("current/theme.name"), "gruvbox\n").unwrap();
        assert_eq!(read_palette(&dir.join("current/theme/colors.toml")).unwrap().name.as_deref(), Some("gruvbox"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Expand a leading `~` so a vault-committed setting works on every machine.
fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

/// The desktop's palette file, if this machine has one we recognise.
#[tauri::command]
pub fn detect_desktop_theme() -> Option<String> {
    cortex_core::settings::desktop_palette_path()
}

/// Follow `path` (empty = stop following). Returns the palette if the file is
/// readable right now; `None` means "fall back to the light/dark setting" —
/// a missing file is not an error, so a vault whose settings name an Omarchy
/// path still opens cleanly on a machine without Omarchy.
#[tauri::command]
pub fn watch_theme_file(app: AppHandle, path: String) -> Result<Option<Palette>> {
    let state = app.state::<ThemeWatcher>();
    if path.trim().is_empty() {
        *state.0.lock().unwrap() = None;
        return Ok(None);
    }
    let abs = expand_home(path.trim());
    if !abs.exists() {
        *state.0.lock().unwrap() = None;
        return Ok(None);
    }
    arm(&app, abs.clone())?;
    Ok(read_palette(&abs).ok())
}

/// (Re)create the watcher for `file`. Watching the directory rather than the
/// file survives editors that write-then-rename; watching the grandparent
/// catches Omarchy replacing the `theme` symlink.
fn arm(app: &AppHandle, file: PathBuf) -> Result<()> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    })
    .map_err(|e| AppError::Other(format!("Theme watcher failed to start: {e}")))?;

    let dir = file.parent().map(Path::to_path_buf);
    let grand = dir.as_ref().and_then(|d| d.parent()).map(Path::to_path_buf);
    for d in [dir, grand].into_iter().flatten() {
        // A directory we can't watch (permissions, vanished) just means fewer
        // triggers, not a broken theme — the initial read already happened.
        let _ = watcher.watch(&d, RecursiveMode::NonRecursive);
    }

    *app.state::<ThemeWatcher>().0.lock().unwrap() = Some(watcher);

    let app = app.clone();
    std::thread::spawn(move || {
        // Wait for a burst, then let it settle: a theme switch rewrites many
        // files, and the symlink swap may land a few ms after the first event.
        if rx.recv().is_err() {
            return; // watcher replaced or stopped before anything happened
        }
        loop {
            match rx.recv_timeout(Duration::from_millis(300)) {
                Ok(()) => continue,
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        let payload = read_palette(&file).ok();
        let _ = app.emit(CHANGED_EVENT, payload);
        // Re-arm so we follow the new symlink target. This drops the current
        // watcher (ours), which is fine — we've done our one job.
        let _ = arm(&app, file);
    });
    Ok(())
}
