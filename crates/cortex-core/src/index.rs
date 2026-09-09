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
    let icon = note.frontmatter.get("icon").and_then(|v| v.as_str()).map(str::to_string);
    let parent = note.frontmatter.get("parent").and_then(|v| v.as_str()).map(str::to_string);
    let tags = note
        .frontmatter
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    let ne = NoteEntry { path: rel.clone(), title, note_type, icon, parent, tags, modified };
    db.upsert_note(&ne, &note.body)?;

    // Only the target names a note: `[[Note|alias]]` and `[[Note#Section]]`
    // both link to `Note`, so that is what the graph and backlinks record.
    let links: Vec<String> = crate::note::extract_wiki_links(&note.body).into_iter().map(|l| l.target).collect();
    db.upsert_links(&rel, &links)?;

    Ok(())
}

fn is_note(p: &Path) -> bool {
    p.extension().and_then(|s| s.to_str()) == Some("md")
        && !p.components().any(|c| {
            matches!(
                c.as_os_str().to_str(),
                Some(".brain") | Some(".git") | Some(".trash") | Some(".cortex")
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backlinks_match_on_the_target_alone() {
        let root = std::env::temp_dir().join(format!("cortex-index-alias-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("notes")).unwrap();
        let w = |rel: &str, s: &str| std::fs::write(root.join(rel), s).unwrap();
        w("notes/target.md", "---\ntitle: Target\n---\n\n## Sec\n\nBody.\n");
        w("notes/aliased.md", "See [[Target|the target]].\n");
        w("notes/sectioned.md", "See [[Target#Sec]].\n");
        w("notes/embedded.md", "![[target#Sec]]\n");
        w("notes/unrelated.md", "See [[Other]].\n");

        let db = Db::open(&root).unwrap();
        index_vault(&root, &db).unwrap();

        let mut back: Vec<String> = db.get_backlinks("notes/target.md").unwrap().into_iter().map(|n| n.path).collect();
        back.sort();
        assert_eq!(back, ["notes/aliased.md", "notes/embedded.md", "notes/sectioned.md"]);

        let mut targets: Vec<String> = db.get_all_links().unwrap().into_iter().map(|(_, t)| t).collect();
        targets.sort();
        assert_eq!(targets, ["Other", "Target", "Target", "target"]);
        let _ = std::fs::remove_dir_all(&root);
    }
}
