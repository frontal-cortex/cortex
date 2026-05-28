use std::path::PathBuf;
use std::time::UNIX_EPOCH;
use tauri::State;
use walkdir::WalkDir;

use crate::commands::vault::VaultState;
use crate::error::{AppError, Result};
use crate::note::{self, Note, NoteEntry};

fn vault_path(state: &State<'_, VaultState>) -> Result<PathBuf> {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or(AppError::NoVault)
}

#[tauri::command]
pub fn list_notes(state: State<'_, VaultState>) -> Result<Vec<NoteEntry>> {
    let root = vault_path(&state)?;
    let mut entries = Vec::new();

    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let p = e.path();
            p.extension().and_then(|s| s.to_str()) == Some("md")
                && !p.components().any(|c| {
                    c.as_os_str() == ".brain" || c.as_os_str() == ".git"
                })
        })
    {
        let abs = entry.path();
        let rel = abs.strip_prefix(&root).unwrap().to_string_lossy().to_string();
        let content = std::fs::read_to_string(abs)?;
        let parsed = note::parse_note(&rel, &content)?;

        let modified = abs
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let title = note::infer_title(&parsed);
        let note_type = parsed
            .frontmatter
            .get("type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let tags = parsed
            .frontmatter
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        entries.push(NoteEntry { path: rel, title, note_type, tags, modified });
    }

    entries.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(entries)
}

#[tauri::command]
pub fn read_note(path: String, state: State<'_, VaultState>) -> Result<Note> {
    let root = vault_path(&state)?;
    let abs = root.join(&path);
    let content = std::fs::read_to_string(&abs)?;
    note::parse_note(&path, &content)
}

#[tauri::command]
pub fn write_note(path: String, note: Note, state: State<'_, VaultState>) -> Result<()> {
    let root = vault_path(&state)?;
    let abs = root.join(&path);

    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let content = note::serialize_note(&note)?;
    std::fs::write(abs, content)?;
    Ok(())
}
