//! The starter vault, bundled into the binary.
//!
//! A new vault used to be `git clone`d from a public template repository,
//! which meant "New vault" needed the network, a `git` binary, and whatever
//! proxy or credential setup the machine had. The files are tiny, so they
//! are compiled in from `crates/cortex-core/vault-template/` instead and
//! written straight to disk: the app and `cortex init` scaffold the same
//! vault, offline, in one step. `VAULT.md` and `AGENTS.md` are not part of
//! the template — the app (and `cortex init`) write the current versions on
//! first open, so a scaffolded vault never carries stale docs.

use std::path::Path;

use crate::error::{AppError, Result};

/// `(vault-relative path, contents)` for every file in the starter vault.
/// Empty files keep otherwise-empty folders (`journal/`, `work/`) in git.
pub const FILES: &[(&str, &str)] = &[
    (".gitignore", include_str!("../vault-template/.gitignore")),
    ("notes/welcome.md", include_str!("../vault-template/notes/welcome.md")),
    ("notes/ideas/second-brain.md", include_str!("../vault-template/notes/ideas/second-brain.md")),
    ("notes/journal/.gitkeep", ""),
    ("notes/work/.gitkeep", ""),
    ("templates/daily.md", include_str!("../vault-template/templates/daily.md")),
    ("templates/note.md", include_str!("../vault-template/templates/note.md")),
];

/// Placeholder in the bundled notes' `created:` fields, replaced with the
/// scaffold date. Deliberately not `{{date}}`, which the note templates use
/// and must keep verbatim.
const TODAY: &str = "{{today}}";

/// Write the starter vault into `root`, which must be empty or absent.
///
/// Only files are written — no git. Callers decide whether to `init` and
/// make an initial commit (the app and `cortex init` both do).
pub fn scaffold(root: &Path) -> Result<()> {
    if root.exists() {
        if !root.is_dir() {
            return Err(AppError::Other(format!("not a directory: {}", root.display())));
        }
        if std::fs::read_dir(root)?.next().is_some() {
            return Err(AppError::Other(format!("directory is not empty: {}", root.display())));
        }
    } else {
        std::fs::create_dir_all(root)?;
    }

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    for (rel, content) in FILES {
        let path = root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, content.replace(TODAY, &today))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cortex-template-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn scaffold_writes_every_file_with_dates_filled() {
        let dir = temp("ok");
        scaffold(&dir).unwrap();
        for (rel, _) in FILES {
            assert!(dir.join(rel).exists(), "missing {rel}");
        }
        let welcome = std::fs::read_to_string(dir.join("notes/welcome.md")).unwrap();
        assert!(!welcome.contains(TODAY));
        assert!(welcome.contains("created: 20"), "created date filled in:\n{welcome}");
        // Note templates keep their own placeholders for the app to expand.
        let daily = std::fs::read_to_string(dir.join("templates/daily.md")).unwrap();
        assert!(daily.contains("{{date}}"));
        assert!(std::fs::read_to_string(dir.join(".gitignore")).unwrap().contains(".brain/"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scaffold_refuses_a_non_empty_directory() {
        let dir = temp("nonempty");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("keep.txt"), "mine").unwrap();
        assert!(scaffold(&dir).is_err());
        assert_eq!(std::fs::read_to_string(dir.join("keep.txt")).unwrap(), "mine");
        assert!(!dir.join("notes").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn bundled_notes_parse_as_notes() {
        for (rel, content) in FILES {
            if rel.starts_with("notes/") && rel.ends_with(".md") {
                let note = crate::note::parse_note(rel, &content.replace(TODAY, "2026-01-01"))
                    .unwrap_or_else(|e| panic!("{rel}: {e}"));
                assert!(note.frontmatter.contains_key("title"), "{rel} has a title");
                assert_eq!(note.frontmatter["created"], "2026-01-01", "{rel} created date");
            }
        }
    }
}
