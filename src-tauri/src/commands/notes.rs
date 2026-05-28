use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;
use tauri::State;
use walkdir::WalkDir;

use crate::commands::vault::{DbState, VaultState};
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

// ── List / Read ──────────────────────────────────────────────────────────────

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
        let note_type = parsed.frontmatter.get("type").and_then(|v| v.as_str()).map(str::to_string);
        let tags = parsed
            .frontmatter
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
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

// ── Write / Create / Delete ──────────────────────────────────────────────────

#[tauri::command]
pub fn write_note(
    path: String,
    note: Note,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    let root = vault_path(&state)?;
    let abs = root.join(&path);

    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let content = note::serialize_note(&note)?;
    std::fs::write(&abs, &content)?;

    // Keep index in sync
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = crate::commands::indexer::index_file(&root, &abs, db);
    }

    Ok(())
}

#[tauri::command]
pub fn create_note(
    path: String,
    title: String,
    created: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<Note> {
    let root = vault_path(&state)?;
    let abs = root.join(&path);

    if abs.exists() {
        return Err(AppError::Other(format!("Note already exists: {path}")));
    }
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut frontmatter: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    frontmatter.insert("title".into(), serde_json::Value::String(title));
    frontmatter.insert("type".into(), serde_json::Value::String("note".into()));
    frontmatter.insert("created".into(), serde_json::Value::String(created));
    frontmatter.insert("tags".into(), serde_json::Value::Array(vec![]));

    let note = Note { path: path.clone(), frontmatter, body: String::new() };
    let content = note::serialize_note(&note)?;
    std::fs::write(&abs, &content)?;

    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = crate::commands::indexer::index_file(&root, &abs, db);
    }

    Ok(note)
}

#[tauri::command]
pub fn delete_note(
    path: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    let root = vault_path(&state)?;
    let abs = root.join(&path);
    if !abs.exists() {
        return Err(AppError::Other(format!("Note not found: {path}")));
    }
    std::fs::remove_file(abs)?;

    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = db.remove_note(&path);
    }

    Ok(())
}

// ── Search ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn search_notes(
    query: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<NoteEntry>> {
    let guard = db_state.0.lock().unwrap();
    match guard.as_ref() {
        Some(db) => db.search(&query),
        None => Ok(vec![]),
    }
}

// ── Folders ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn delete_folder(
    path: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    let root = vault_path(&state)?;

    // Protect system and root directories
    let trimmed = path.trim_end_matches('/');
    if trimmed.contains("..") || matches!(trimmed, ".git" | ".brain" | "notes" | "templates") {
        return Err(AppError::Other(format!("Cannot delete protected path: {path}")));
    }

    let abs = root.join(&path);
    if !abs.exists() {
        return Err(AppError::Other(format!("Folder not found: {path}")));
    }

    std::fs::remove_dir_all(&abs)?;

    // Purge index entries for all notes that were inside this folder
    let prefix = if path.ends_with('/') { path.clone() } else { format!("{path}/") };
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = db.remove_notes_by_prefix(&prefix);
    }

    Ok(())
}

/// Move a note to a different folder, keeping the same filename.
/// Returns the new vault-relative path.
#[tauri::command]
pub fn move_note(
    from_path: String,
    to_dir: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<String> {
    let root = vault_path(&state)?;
    let from_abs = root.join(&from_path);

    if !from_abs.exists() {
        return Err(AppError::Other(format!("Source not found: {from_path}")));
    }

    let filename = from_abs
        .file_name()
        .ok_or_else(|| AppError::Other("Invalid source path".into()))?;

    let to_dir_clean = to_dir.trim_end_matches('/');
    let to_dir_abs = root.join(to_dir_clean);
    std::fs::create_dir_all(&to_dir_abs)?;

    let to_abs = to_dir_abs.join(filename);

    if to_abs.exists() {
        return Err(AppError::Other(format!(
            "A note with this name already exists in {}",
            to_dir_clean
        )));
    }

    let new_path = format!("{}/{}", to_dir_clean, filename.to_string_lossy());
    std::fs::rename(&from_abs, &to_abs)?;

    // Update index: rename the path row, then re-index the content at new location
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = db.rename_note(&from_path, &new_path);
        let _ = crate::commands::indexer::index_file(&root, &to_abs, db);
    }

    Ok(new_path)
}

#[tauri::command]
pub fn create_folder(path: String, state: State<'_, VaultState>) -> Result<()> {
    let root = vault_path(&state)?;

    // Guard against path traversal and system directories
    if path.contains("..") || path.starts_with('/') || path.starts_with('\\') {
        return Err(AppError::Other("Invalid folder path".into()));
    }
    let first = path.split('/').next().unwrap_or("");
    if matches!(first, ".git" | ".brain") {
        return Err(AppError::Other("Cannot create folders in system directories".into()));
    }

    let abs = root.join(&path);
    std::fs::create_dir_all(&abs)?;

    // .gitkeep so git tracks the otherwise-empty directory
    let gitkeep = abs.join(".gitkeep");
    if !gitkeep.exists() {
        std::fs::write(gitkeep, "")?;
    }

    Ok(())
}

/// Return all subdirectory paths under `notes/`, relative to vault root,
/// with a trailing slash. Used by the frontend to show empty directories.
#[tauri::command]
pub fn list_vault_dirs(state: State<'_, VaultState>) -> Result<Vec<String>> {
    let root = vault_path(&state)?;
    let notes_root = root.join("notes");

    if !notes_root.exists() {
        return Ok(vec![]);
    }

    let mut dirs = Vec::new();
    for entry in WalkDir::new(&notes_root)
        .min_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
    {
        if let Ok(rel) = entry.path().strip_prefix(&root) {
            let mut path = rel.to_string_lossy().replace('\\', "/");
            if !path.ends_with('/') {
                path.push('/');
            }
            dirs.push(path);
        }
    }

    dirs.sort();
    Ok(dirs)
}

// ── Backlinks ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_backlinks(
    path: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<NoteEntry>> {
    let guard = db_state.0.lock().unwrap();
    match guard.as_ref() {
        Some(db) => db.get_backlinks(&path),
        None => Ok(vec![]),
    }
}

// ── Templates ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_templates(state: State<'_, VaultState>) -> Result<Vec<String>> {
    let root = vault_path(&state)?;
    let templates_dir = root.join("templates");
    if !templates_dir.exists() {
        return Ok(vec![]);
    }
    let names = std::fs::read_dir(templates_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().and_then(|s| s.to_str()) == Some("md")
        })
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .collect();
    Ok(names)
}

/// Read a template file by name (e.g. "daily.md") and return its raw content.
/// Returns None if the template doesn't exist — the frontend falls back gracefully.
#[tauri::command]
pub fn read_template(name: String, state: State<'_, VaultState>) -> Result<Option<String>> {
    let root = vault_path(&state)?;
    let path = root.join("templates").join(&name);
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path)?;
    Ok(Some(content))
}
