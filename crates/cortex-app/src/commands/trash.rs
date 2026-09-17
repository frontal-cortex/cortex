//! The trash: listing, restoring and emptying it. The move into it is
//! `cortex_core::trash`, shared with the CLI and MCP server.

use crate::ctx::AppCtx;
use serde::Serialize;
use std::path::{Path, PathBuf};

use cortex_core::error::{AppError, Result};
pub use cortex_core::trash::{move_to_trash, now_secs, trash_dir, TrashMeta};

#[derive(Debug, Serialize)]
pub struct TrashEntry {
    pub id: String,
    pub original_path: String,
    pub title: String,
    pub deleted_at: u64,
}

pub fn list_trash(ctx: &AppCtx) -> Result<Vec<TrashEntry>> {
    let root = ctx.vault_path()?;
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
pub fn restore_trashed(ctx: &AppCtx, id: String) -> Result<String> {
    let root = ctx.vault_path()?;
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

    if let Some(db) = ctx.db.0.lock().unwrap().as_ref() {
        let _ = cortex_core::index::index_file(&root, &target_abs, db);
    }

    Ok(target_rel)
}

/// Permanently remove a single trashed item.
pub fn delete_trashed(ctx: &AppCtx, id: String) -> Result<()> {
    let root = ctx.vault_path()?;
    let dir = trash_dir(&root);
    let _ = std::fs::remove_file(dir.join(format!("{id}.md")));
    let _ = std::fs::remove_file(dir.join(format!("{id}.meta.yaml")));
    Ok(())
}

/// Permanently empty the trash.
pub fn empty_trash(ctx: &AppCtx) -> Result<()> {
    let root = ctx.vault_path()?;
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

/// Move a collection to the trash: every note in `collections/<name>/` — the
/// rows, the page (`_index.md`) and its row templates — goes in as its own
/// entry, so any of them can be restored later; the folder is removed once it
/// is empty. The schema under `.cortex/schemas/` is left in place: restoring
/// a row should find its properties still typed. Returns how many files moved.
pub fn trash_collection(ctx: &AppCtx, name: String) -> Result<usize> {
    if name.is_empty() || name.contains('/') || name.contains("..") {
        return Err(AppError::Other("Invalid collection name".into()));
    }
    let root = ctx.vault_path()?;
    let dir = root.join("collections").join(&name);
    if !dir.is_dir() {
        return Err(AppError::Other(format!("Collection not found: {name}")));
    }
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("md"))
        .collect();
    files.sort();
    let mut moved = 0;
    for abs in files {
        let rel = abs.strip_prefix(&root).map_err(|_| AppError::Other("path outside vault".into()))?.to_string_lossy().replace('\\', "/");
        move_to_trash(&root, &rel)?;
        moved += 1;
    }
    // Only an empty folder is removed; anything that is not a note stays put.
    let _ = std::fs::remove_dir(&dir);
    if let Some(db) = ctx.db.0.lock().unwrap().as_ref() {
        let _ = db.remove_notes_by_prefix(&format!("collections/{name}/"));
    }
    Ok(moved)
}
