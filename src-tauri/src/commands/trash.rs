//! Soft-delete. Deleting a note moves it to `.trash/` (committed, so it syncs
//! and can be restored on any clone) rather than destroying it. Each trashed
//! note keeps its content as readable markdown plus a small YAML sidecar
//! recording where it came from.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::commands::vault::{DbState, VaultState};
use cortex_core::error::{AppError, Result};
use cortex_core::note;

fn vault_path(state: &State<'_, VaultState>) -> Result<PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

fn trash_dir(root: &Path) -> PathBuf {
    root.join(".trash")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrashMeta {
    pub original_path: String,
    pub title: String,
    pub deleted_at: u64,
}

#[derive(Debug, Serialize)]
pub struct TrashEntry {
    pub id: String,
    pub original_path: String,
    pub title: String,
    pub deleted_at: u64,
}

fn sanitize(stem: &str) -> String {
    stem.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// Move a note at `rel_path` into the trash. Returns the trash id. Called by
/// `delete_note`.
pub fn move_to_trash(root: &Path, rel_path: &str) -> Result<String> {
    let abs = root.join(rel_path);
    let content = std::fs::read_to_string(&abs)?;
    let parsed = note::parse_note(rel_path, &content)?;
    let title = note::infer_title(&parsed);

    let stem = Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("note");
    let id = format!("{}-{}", now_secs(), sanitize(stem));

    let dir = trash_dir(root);
    std::fs::create_dir_all(&dir)?;

    std::fs::write(dir.join(format!("{id}.md")), &content)?;
    let meta = TrashMeta {
        original_path: rel_path.to_string(),
        title,
        deleted_at: now_secs(),
    };
    std::fs::write(dir.join(format!("{id}.meta.yaml")), serde_yaml::to_string(&meta)?)?;

    std::fs::remove_file(&abs)?;
    Ok(id)
}

#[tauri::command]
pub fn list_trash(state: State<'_, VaultState>) -> Result<Vec<TrashEntry>> {
    let root = vault_path(&state)?;
    let dir = trash_dir(&root);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)?.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(id) = name.strip_suffix(".meta.yaml") else { continue };
        let Ok(content) = std::fs::read_to_string(entry.path()) else { continue };
        let Ok(meta) = serde_yaml::from_str::<TrashMeta>(&content) else { continue };
        out.push(TrashEntry {
            id: id.to_string(),
            original_path: meta.original_path,
            title: meta.title,
            deleted_at: meta.deleted_at,
        });
    }
    out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(out)
}

/// Restore a trashed note to its original location (or a non-colliding variant
/// if something already lives there). Returns the path it was restored to.
#[tauri::command]
pub fn restore_trashed(
    id: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<String> {
    let root = vault_path(&state)?;
    let dir = trash_dir(&root);

    let meta_path = dir.join(format!("{id}.meta.yaml"));
    let md_path = dir.join(format!("{id}.md"));
    if !meta_path.exists() || !md_path.exists() {
        return Err(AppError::Other(format!("Trash item not found: {id}")));
    }

    let meta: TrashMeta = serde_yaml::from_str(&std::fs::read_to_string(&meta_path)?)?;
    let content = std::fs::read_to_string(&md_path)?;

    let mut target_rel = meta.original_path.clone();
    let mut target_abs = root.join(&target_rel);
    if target_abs.exists() {
        // Avoid clobbering: insert `-restored-<ts>` before the extension.
        let stem = Path::new(&meta.original_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("note");
        let parent = Path::new(&meta.original_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| "notes".to_string());
        target_rel = format!("{parent}/{stem}-restored-{}.md", now_secs());
        target_abs = root.join(&target_rel);
    }

    if let Some(p) = target_abs.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(&target_abs, &content)?;

    std::fs::remove_file(&md_path)?;
    std::fs::remove_file(&meta_path)?;

    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = cortex_core::index::index_file(&root, &target_abs, db);
    }

    Ok(target_rel)
}

/// Permanently remove a single trashed item.
#[tauri::command]
pub fn delete_trashed(id: String, state: State<'_, VaultState>) -> Result<()> {
    let root = vault_path(&state)?;
    let dir = trash_dir(&root);
    let _ = std::fs::remove_file(dir.join(format!("{id}.md")));
    let _ = std::fs::remove_file(dir.join(format!("{id}.meta.yaml")));
    Ok(())
}

/// Permanently empty the trash.
#[tauri::command]
pub fn empty_trash(state: State<'_, VaultState>) -> Result<()> {
    let root = vault_path(&state)?;
    let dir = trash_dir(&root);
    if dir.exists() {
        for entry in std::fs::read_dir(&dir)?.filter_map(|e| e.ok()) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// Best-effort prune of trashed notes older than `retention_days`. A value of 0
/// disables pruning. Called on vault open.
pub fn prune_expired(root: &Path, retention_days: u32) -> Result<()> {
    if retention_days == 0 {
        return Ok(());
    }
    let dir = trash_dir(root);
    if !dir.exists() {
        return Ok(());
    }
    let cutoff = now_secs().saturating_sub(retention_days as u64 * 86_400);

    for entry in std::fs::read_dir(&dir)?.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(id) = name.strip_suffix(".meta.yaml") else { continue };
        let Ok(content) = std::fs::read_to_string(entry.path()) else { continue };
        let Ok(meta) = serde_yaml::from_str::<TrashMeta>(&content) else { continue };
        if meta.deleted_at < cutoff {
            let _ = std::fs::remove_file(dir.join(format!("{id}.md")));
            let _ = std::fs::remove_file(dir.join(format!("{id}.meta.yaml")));
        }
    }
    Ok(())
}
