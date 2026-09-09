//! Disposable UI state — `.brain/ui-state.json`.
//!
//! `.brain/` is the gitignored cache, so nothing here is ever committed or
//! shared; deleting the file loses nothing but convenience. Today it holds
//! the recently opened notes (the sidebar's Recent section and the quick
//! switcher's empty-query list). Every read tolerates a missing or broken
//! file, and every write is best-effort: UI memory must never block a note
//! from opening.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::error::Result;

/// How many recently opened notes are remembered.
pub const MAX_RECENT_NOTES: usize = 10;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct UiState {
    /// Vault-relative note paths, most recently opened first.
    #[serde(default)]
    pub recent_notes: Vec<String>,
}

fn file(root: &Path) -> PathBuf {
    root.join(".brain").join("ui-state.json")
}

/// The saved state, or the default when the file is missing or unreadable.
pub fn load(root: &Path) -> UiState {
    std::fs::read_to_string(file(root))
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

pub fn save(root: &Path, state: &UiState) -> Result<()> {
    let path = file(root);
    std::fs::create_dir_all(path.parent().unwrap())?;
    let json = serde_json::to_string_pretty(state).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    std::fs::write(path, json)?;
    Ok(())
}

/// Recently opened notes, most recent first, minus any whose file is gone
/// (a deleted or renamed note must not linger as a dead row).
pub fn recent_notes(root: &Path) -> Vec<String> {
    load(root)
        .recent_notes
        .into_iter()
        .filter(|p| root.join(p).is_file())
        .collect()
}

/// Move `path` to the front of the recent list and persist it, keeping the
/// list at [`MAX_RECENT_NOTES`]. Returns the new list.
pub fn record_recent_note(root: &Path, path: &str) -> Result<Vec<String>> {
    let mut state = load(root);
    state.recent_notes.retain(|p| p != path);
    state.recent_notes.insert(0, path.to_string());
    state.recent_notes.truncate(MAX_RECENT_NOTES);
    save(root, &state)?;
    Ok(state.recent_notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cortex-ui-state-{}-{}", std::process::id(), rand_suffix()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("notes")).unwrap();
        dir
    }

    fn rand_suffix() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    #[test]
    fn missing_file_is_empty() {
        let dir = temp_vault();
        assert_eq!(load(&dir), UiState::default());
        assert!(recent_notes(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn record_moves_to_front_and_caps() {
        let dir = temp_vault();
        for i in 0..12 {
            let p = format!("notes/n{i}.md");
            std::fs::write(dir.join(&p), "x").unwrap();
            record_recent_note(&dir, &p).unwrap();
        }
        let list = record_recent_note(&dir, "notes/n3.md").unwrap();
        assert_eq!(list.len(), MAX_RECENT_NOTES);
        assert_eq!(list[0], "notes/n3.md");
        assert_eq!(list[1], "notes/n11.md");
        assert_eq!(list.iter().filter(|p| *p == "notes/n3.md").count(), 1, "no duplicates");
        assert!(!list.contains(&"notes/n0.md".to_string()), "the oldest fell off");
        assert!(dir.join(".brain/ui-state.json").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn recent_notes_drops_missing_files() {
        let dir = temp_vault();
        std::fs::write(dir.join("notes/keep.md"), "x").unwrap();
        record_recent_note(&dir, "notes/gone.md").unwrap();
        record_recent_note(&dir, "notes/keep.md").unwrap();
        assert_eq!(recent_notes(&dir), vec!["notes/keep.md".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn broken_file_is_tolerated() {
        let dir = temp_vault();
        std::fs::create_dir_all(dir.join(".brain")).unwrap();
        std::fs::write(dir.join(".brain/ui-state.json"), "{not json").unwrap();
        assert!(recent_notes(&dir).is_empty());
        std::fs::write(dir.join("notes/a.md"), "x").unwrap();
        assert_eq!(record_recent_note(&dir, "notes/a.md").unwrap(), vec!["notes/a.md".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
