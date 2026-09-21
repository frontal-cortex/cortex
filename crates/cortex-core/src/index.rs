use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

use crate::db::Db;
use crate::error::Result;
use crate::note::{self, NoteEntry};

/// What this indexer writes. Raise it when a change makes an index built by
/// an older version incomplete, and the next vault open re-reads every note:
///   2 — relation properties are recorded as links (`kind = relation`).
pub const INDEX_VERSION: u32 = 2;

/// Re-index every `.md` file in the vault. Called on vault open.
pub fn index_vault(root: &Path, db: &Db) -> Result<()> {
    // Opening a vault used to re-parse and re-write every note, each statement
    // its own commit: ninety notes took seconds and froze the window. Now one
    // transaction, notes whose mtime the index already holds are skipped, rows
    // for notes gone from disk are dropped, and the walk never enters the
    // cache, git, trash or config folders.
    // An index from an older version of this code is missing whatever that
    // version did not write: read everything once, then trust file times again.
    let stale = db.index_version() < INDEX_VERSION;
    let known: std::collections::HashMap<String, u64> =
        if stale { Default::default() } else { db.paths_with_modified()?.into_iter().collect() };
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    db.with_transaction(|| {
        let walker = WalkDir::new(root).into_iter().filter_entry(|e| {
            e.depth() == 0 || !crate::vault::is_hidden_component(&e.path().components().next_back().unwrap_or(std::path::Component::CurDir))
        });
        for entry in walker.filter_map(|e| e.ok()).filter(|e| e.file_type().is_file() && is_note(e.path())) {
            let rel = entry.path().strip_prefix(root).unwrap_or(entry.path()).to_string_lossy().to_string();
            let mtime = entry.metadata().ok().and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            seen.insert(rel.clone());
            if known.get(&rel) == Some(&mtime) && mtime != 0 {
                continue;
            }
            let _ = index_file(root, entry.path(), db);
        }
        for gone in known.keys().filter(|p| !seen.contains(*p)) {
            let _ = db.remove_note(gone);
        }
        Ok(())
    })?;
    if stale {
        // A note dropped from disk while the old index knew it: with `known`
        // emptied above, the sweep could not see it, so clear what is gone now.
        let on_disk: std::collections::HashSet<String> = db.paths_with_modified()?.into_iter().map(|(p, _)| p).collect();
        for path in on_disk {
            if !root.join(&path).exists() { let _ = db.remove_note(&path); }
        }
        db.set_index_version(INDEX_VERSION)?;
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
    // Frontmatter `tags:` merged with inline `#tags` from the body.
    let tags = crate::tags::note_tags(&note);

    let created = note.frontmatter.get("created").and_then(|v| v.as_str()).map(str::to_string);
    let ne = NoteEntry { path: rel.clone(), title, note_type, icon, parent, tags, modified, created };
    db.upsert_note(&ne, &note.body)?;

    // Only the target names a note: `[[Note|alias]]` and `[[Note#Section]]`
    // both link to `Note`, so that is what the graph and backlinks record.
    let links: Vec<String> = crate::note::extract_wiki_links(&note.body).into_iter().map(|l| l.target).collect();
    db.upsert_links_and_relations(&rel, &links, &relation_targets(root, &rel, &note))?;

    Ok(())
}

/// The rows a row's relation properties name — the other half of the graph.
/// An expense's `category` and `account`, a transfer's two accounts, a bill's
/// category: written as frontmatter, not as `[[links]]`, so without this a
/// database of hundreds of rows is hundreds of islands. The target is the
/// related row's title, exactly as a wiki link's target would be.
fn relation_targets(root: &Path, rel: &str, note: &note::Note) -> Vec<String> {
    let Some(collection) = crate::vault::row_collection(rel) else { return vec![] };
    let Ok(Some(schema)) = crate::schema::load(root, &collection) else { return vec![] };
    let mut out: Vec<String> = Vec::new();
    for p in &schema.properties {
        // The forward side only: a reverse rollup (`from:`) is the same edge
        // seen from the other end, and would double every one of them.
        if p.ty != crate::schema::PropType::Relation || p.from.is_some() { continue; }
        let Some(value) = note.frontmatter.get(&p.name) else { continue };
        let titles: Vec<String> = match value {
            serde_json::Value::String(s) => vec![s.clone()],
            serde_json::Value::Array(items) => items.iter().filter_map(|v| v.as_str().map(str::to_string)).collect(),
            _ => vec![],
        };
        for t in titles {
            let t = t.trim().to_string();
            if !t.is_empty() && !out.contains(&t) { out.push(t); }
        }
    }
    out
}

fn is_note(p: &Path) -> bool {
    p.extension().and_then(|s| s.to_str()) == Some("md")
        && !p.components().any(|c| {
            matches!(
                c.as_os_str().to_str(),
                Some(".brain") | Some(".git") | Some(".trash") | Some(".cortex")
            )
        })
        && !is_row_template(p)
}

/// A collection's row template (`collections/<c>/_template-<slug>.md`) is a
/// shape for new rows, not a note: its title is a `{{placeholder}}`, so it
/// must not appear in search, the graph or the quick switcher. `_index.md`
/// is the collection page and stays indexed.
fn is_row_template(p: &Path) -> bool {
    let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
    name.starts_with('_') && name != "_index.md"
        && p.components().any(|c| c.as_os_str().to_str() == Some("collections"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reindex_is_incremental_and_drops_deleted_notes() {
        let root = std::env::temp_dir().join(format!("cortex-index-incr-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::create_dir_all(root.join(".git/objects")).unwrap();
        std::fs::create_dir_all(root.join(".trash")).unwrap();
        std::fs::create_dir_all(root.join("collections/tasks")).unwrap();
        let w = |rel: &str, s: &str| std::fs::write(root.join(rel), s).unwrap();
        w("notes/keep.md", "---\ntitle: Keep\n---\nalpha\n");
        w("notes/gone.md", "---\ntitle: Gone\n---\nbeta\n");
        w("notes/edit.md", "---\ntitle: Edit\n---\ngamma\n");
        w(".git/objects/note.md", "---\ntitle: Not a note\n---\nzeta\n");
        w(".trash/old.md", "---\ntitle: Trashed\n---\neta\n");
        w("collections/tasks/_template-tasks.md", "---\ntitle: '{{title}}'\n---\nshape\n");
        w("collections/tasks/_index.md", "---\ntitle: Tasks\ntype: database\n---\n");

        let db = Db::open(&root).unwrap();
        index_vault(&root, &db).unwrap();
        let mut paths: Vec<String> = db.list_notes().unwrap().into_iter().map(|n| n.path).collect();
        paths.sort();
        assert_eq!(paths, ["collections/tasks/_index.md", "notes/edit.md", "notes/gone.md", "notes/keep.md"], "hidden folders and row templates are never indexed; the collection page is");

        // Second pass: one file deleted, one changed with a newer mtime, one untouched.
        std::fs::remove_file(root.join("notes/gone.md")).unwrap();
        w("notes/edit.md", "---\ntitle: Edit\n---\ndelta\n");
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        let f = std::fs::OpenOptions::new().write(true).open(root.join("notes/edit.md")).unwrap();
        f.set_modified(later).unwrap();
        index_vault(&root, &db).unwrap();
        let mut paths: Vec<String> = db.list_notes().unwrap().into_iter().map(|n| n.path).collect();
        paths.sort();
        assert_eq!(paths, ["collections/tasks/_index.md", "notes/edit.md", "notes/keep.md"], "a deleted note leaves the index");
        assert!(db.search("delta").unwrap().iter().any(|h| h.entry.path == "notes/edit.md"), "a changed note is re-read");
        assert!(db.search("beta").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_index_from_an_older_version_is_read_again_in_full() {
        let root = std::env::temp_dir().join(format!("cortex-index-version-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("collections/expenses")).unwrap();
        std::fs::create_dir_all(root.join(".cortex/schemas")).unwrap();
        let w = |rel: &str, s: &str| std::fs::write(root.join(rel), s).unwrap();
        w(".cortex/schemas/expenses.yaml", "properties:\n  - name: account\n    type: relation\n    collection: accounts\n");
        w("collections/expenses/lunch.md", "---\ntitle: Lunch\naccount: [\"Checking\"]\n---\n");

        let db = Db::open(&root).unwrap();
        index_vault(&root, &db).unwrap();
        assert_eq!(db.index_version(), INDEX_VERSION);
        assert!(db.get_all_links().unwrap().iter().any(|(s, t)| s == "collections/expenses/lunch.md" && t == "Checking"));

        // An index written before relations were recorded: the files have not
        // changed, so only the version can say it must be read again.
        db.upsert_links("collections/expenses/lunch.md", &[]).unwrap();
        db.set_index_version(1).unwrap();
        assert!(db.get_all_links().unwrap().is_empty());
        index_vault(&root, &db).unwrap();
        assert!(db.get_all_links().unwrap().iter().any(|(s, t)| s == "collections/expenses/lunch.md" && t == "Checking"), "the older index is rebuilt");
        assert_eq!(db.index_version(), INDEX_VERSION);

        // A note deleted while the older index knew it still leaves.
        std::fs::remove_file(root.join("collections/expenses/lunch.md")).unwrap();
        db.set_index_version(1).unwrap();
        index_vault(&root, &db).unwrap();
        assert!(db.list_notes().unwrap().is_empty(), "the deleted note is gone from a rebuilt index");
        let _ = std::fs::remove_dir_all(&root);
    }

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
