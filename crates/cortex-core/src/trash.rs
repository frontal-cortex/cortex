//! Soft-delete. Deleting a note moves it to `.trash/` (committed, so it syncs
//! and can be restored on any clone) rather than destroying it. Each trashed
//! note keeps its content as readable markdown plus a small YAML sidecar
//! recording where it came from. Listing and restoring live in the app; the
//! move itself is here so the CLI and MCP server trash exactly as the app does.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::Result;
use crate::note;

pub fn trash_dir(root: &Path) -> PathBuf {
    root.join(".trash")
}

pub fn now_secs() -> u64 {
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

fn sanitize(stem: &str) -> String {
    stem.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// Move a note at `rel_path` into the trash. Returns the trash id.
pub fn move_to_trash(root: &Path, rel_path: &str) -> Result<String> {
    let abs = root.join(rel_path);
    let content = std::fs::read_to_string(&abs)?;
    let parsed = note::parse_note(rel_path, &content)?;
    let title = note::infer_title(&parsed);

    let stem = Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("note");
    let dir = trash_dir(root);
    std::fs::create_dir_all(&dir)?;
    // Ids are stamped to the second: two notes with one file name trashed in
    // the same second (rows of different collections) must not share an entry.
    let base = format!("{}-{}", now_secs(), sanitize(stem));
    let mut id = base.clone();
    let mut n = 2;
    while dir.join(format!("{id}.meta.yaml")).exists() {
        id = format!("{base}-{n}");
        n += 1;
    }

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
