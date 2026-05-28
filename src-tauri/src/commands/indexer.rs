use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

use crate::db::Db;
use crate::error::Result;
use crate::note::{self, NoteEntry};

/// Re-index every `.md` file in the vault. Called on vault open.
pub fn index_vault(root: &Path, db: &Db) -> Result<()> {
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| is_note(e.path()))
    {
        let _ = index_file(root, entry.path(), db);
    }
    Ok(())
}

/// Update the index for a single file. Called after write/create.
pub fn index_file(root: &Path, abs: &Path, db: &Db) -> Result<()> {
    let rel = abs.strip_prefix(root).unwrap().to_string_lossy().to_string();
    let content = std::fs::read_to_string(abs)?;
    let note = note::parse_note(&rel, &content)?;

    let modified = abs
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let title = note::infer_title(&note);
    let note_type = note.frontmatter.get("type").and_then(|v| v.as_str()).map(str::to_string);
    let tags = note
        .frontmatter
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    let ne = NoteEntry { path: rel, title, note_type, tags, modified };
    db.upsert_note(&ne, &note.body)
}

fn is_note(p: &Path) -> bool {
    p.extension().and_then(|s| s.to_str()) == Some("md")
        && !p.components().any(|c| c.as_os_str() == ".brain" || c.as_os_str() == ".git")
}
