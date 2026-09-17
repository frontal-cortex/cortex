//! Rename or move a note and keep every inbound link pointing at it.
//!
//! Links resolve by path, title or filename stem (`vault::resolve`), so any
//! of those changing orphans the `[[links]]` written against the old value.
//! `rename_note` moves the file, optionally retitles it, then rewrites the
//! referrers the index knows about — `[[old]]`, `[[old|alias]]`,
//! `[[old#Section]]` and `![[old]]` all become the new target with their
//! alias, section and embed bang intact. The app, `cortex mv`, the MCP
//! `move_note` tool and a title edit in the editor all come through here.

use serde::Serialize;
use std::collections::BTreeSet;
use std::path::Path;

use crate::db::Db;
use crate::error::{AppError, Result};
use crate::{git, index, note, settings, vault};

/// What a rename did: where the note went, what it is called now, which
/// notes had links rewritten, and whether that was committed.
#[derive(Debug, Clone, Serialize)]
pub struct RenameReport {
    pub old_path: String,
    pub new_path: String,
    pub old_title: String,
    pub new_title: String,
    /// Vault-relative paths of the notes whose links were rewritten, sorted.
    pub rewritten: Vec<String>,
    /// True when `auto_commit` is on and the change was committed as one commit.
    pub committed: bool,
}

impl RenameReport {
    /// One line naming the change, used as the commit message.
    pub fn commit_message(&self) -> String {
        let what = if self.old_path != self.new_path {
            format!("Rename {} → {}", self.old_path, self.new_path)
        } else {
            format!("Rename '{}' → '{}'", self.old_title, self.new_title)
        };
        match self.rewritten.len() {
            0 => what,
            1 => format!("{what} (1 note relinked)"),
            n => format!("{what} ({n} notes relinked)"),
        }
    }
}

/// Move `old_path` to `new_path` (the same path is fine when only the title
/// changes), set `new_title` if given, and rewrite every inbound link so it
/// still lands on this note. Both paths are vault-relative and end in `.md`.
/// Commits the result when `auto_commit` is on.
pub fn rename_note(root: &Path, db: &Db, old_path: &str, new_path: &str, new_title: Option<&str>) -> Result<RenameReport> {
    let from_abs = root.join(old_path);
    let to_abs = root.join(new_path);
    if !from_abs.is_file() {
        return Err(AppError::Other(format!("Source not found: {old_path}")));
    }
    if old_path != new_path && to_abs.exists() {
        return Err(AppError::Other(format!("Target already exists: {new_path}")));
    }

    let content = std::fs::read_to_string(&from_abs)?;
    let mut parsed = note::parse_note(old_path, &content)?;
    let old_title = note::infer_title(&parsed);
    // Which of the old keys were unambiguous before the rename. A `[[Plan]]`
    // that could have meant two notes is left alone: rewriting it would steal
    // the other note's links.
    let others: Vec<_> = vault::list_notes(root).into_iter().filter(|n| n.path != old_path).collect();
    let title_shared = others.iter().any(|n| n.title.eq_ignore_ascii_case(&old_title));
    let stem_shared = others.iter().any(|n| vault::stem(&n.path).eq_ignore_ascii_case(vault::stem(old_path)));

    if old_path != new_path {
        if let Some(parent) = to_abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(&from_abs, &to_abs)?;
        crate::comments::rename(root, old_path, new_path)?;
        db.rename_note(old_path, new_path)?;
    }

    let new_title = match new_title.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) if t != old_title => {
            parsed.path = new_path.to_string();
            parsed.frontmatter.insert("title".into(), serde_json::Value::String(t.to_string()));
            std::fs::write(&to_abs, note::serialize_note(&parsed)?)?;
            t.to_string()
        }
        _ => old_title.clone(),
    };
    index::index_file(root, &to_abs, db)?;

    // Every way a link could have named the old note, paired with what it
    // should say now. Only keys that actually changed need a pass.
    let mut pairs: Vec<(String, String)> = Vec::new();
    if old_path != new_path {
        pairs.push((old_path.to_string(), new_path.to_string()));
        pairs.push((sans_md(old_path).to_string(), sans_md(new_path).to_string()));
        let (old_stem, new_stem) = (vault::stem(old_path), vault::stem(new_path));
        if !old_stem.eq_ignore_ascii_case(new_stem) && !stem_shared {
            pairs.push((old_stem.to_string(), new_stem.to_string()));
        }
    }
    if old_title != new_title && !title_shared {
        pairs.push((old_title.clone(), new_title.clone()));
    }

    let mut rewritten = BTreeSet::new();
    for (old, new) in &pairs {
        rewritten.extend(rewrite_links(root, db, old, new)?);
    }

    let mut report = RenameReport {
        old_path: old_path.to_string(),
        new_path: new_path.to_string(),
        old_title,
        new_title,
        rewritten: rewritten.into_iter().collect(),
        committed: false,
    };
    report.committed = commit_if_auto(root, &report.commit_message())?;
    Ok(report)
}

/// The note at `path` has already been retitled (the editor saves the
/// title as it is typed); now that the edit is final, point the links that
/// named the old title at the new one. Same ambiguity rule as `rename_note`.
pub fn title_changed(root: &Path, db: &Db, path: &str, old_title: &str, new_title: &str) -> Result<RenameReport> {
    let (old_title, new_title) = (old_title.trim(), new_title.trim());
    let mut report = RenameReport {
        old_path: path.to_string(),
        new_path: path.to_string(),
        old_title: old_title.to_string(),
        new_title: new_title.to_string(),
        rewritten: Vec::new(),
        committed: false,
    };
    if old_title.is_empty() || new_title.is_empty() || old_title == new_title {
        return Ok(report);
    }
    let title_shared = vault::list_notes(root)
        .iter()
        .any(|n| n.path != path && n.title.eq_ignore_ascii_case(old_title));
    if title_shared {
        return Ok(report);
    }
    report.rewritten = rewrite_links(root, db, old_title, new_title)?;
    if !report.rewritten.is_empty() {
        report.committed = commit_if_auto(root, &report.commit_message())?;
    }
    Ok(report)
}

/// Rewrite every note that links to `old_target` so it links to `new_target`
/// instead, keeping aliases, sections and embed bangs (see
/// `note::rewrite_wiki_links`). Referrers come from the index's `links`
/// table; each changed file is re-indexed. Returns their paths, sorted.
pub fn rewrite_links(root: &Path, db: &Db, old_target: &str, new_target: &str) -> Result<Vec<String>> {
    let old_lower = old_target.trim().to_lowercase();
    if old_lower.is_empty() || old_lower == new_target.trim().to_lowercase() {
        return Ok(Vec::new());
    }
    let sources: BTreeSet<String> = db
        .get_all_links()?
        .into_iter()
        .filter(|(_, target)| target.to_lowercase() == old_lower)
        .map(|(source, _)| source)
        .collect();

    let mut rewritten = Vec::new();
    for rel in sources {
        let abs = root.join(&rel);
        let Ok(text) = std::fs::read_to_string(&abs) else { continue };
        let (out, changed) = note::rewrite_wiki_links(&text, old_target, new_target);
        if changed == 0 {
            continue;
        }
        std::fs::write(&abs, out)?;
        index::index_file(root, &abs, db)?;
        rewritten.push(rel);
    }
    Ok(rewritten)
}

/// Commit the working tree with `message` if the vault's `auto_commit`
/// setting is on and the vault is a git repository. Returns whether it did.
pub fn commit_if_auto(root: &Path, message: &str) -> Result<bool> {
    if !settings::load(root)?.auto_commit {
        return Ok(false);
    }
    let Ok(repo) = git::open(root) else { return Ok(false) };
    git::stage_all_and_commit(&repo, message)?;
    Ok(true)
}

fn sans_md(path: &str) -> &str {
    path.strip_suffix(".md").unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway vault (not a git repo, auto_commit irrelevant) with one
    /// target note and referrers in every link form.
    fn fixture(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("cortex-rename-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("notes/other")).unwrap();
        let w = |rel: &str, s: &str| std::fs::write(root.join(rel), s).unwrap();
        w("notes/plan.md", "---\ntags: [a]\ntitle: The Plan\n---\n\n## Goals\n\nSee [[The Plan#Goals]] (self).\n");
        w(
            "notes/refs.md",
            "---\ntitle: Refs\n---\n\nBy title [[The Plan]], [[the plan|our plan]], [[The Plan#Goals]], [[The Plan#Goals|goals]].\n\
             By stem [[plan]] and ![[plan#Goals]]. By path [[notes/plan]] and [[notes/plan.md]].\n\
             Not it: [[Planning]] and [[Other]].\n",
        );
        w("notes/other/untouched.md", "---\ntitle: Other\n---\n\nLinks to [[Refs]] and [[Planning]] only.\n");
        w("notes/other/planning.md", "---\ntitle: Planning\n---\n\nNothing.\n");
        root
    }

    fn read(root: &Path, rel: &str) -> String {
        std::fs::read_to_string(root.join(rel)).unwrap()
    }

    #[test]
    fn rename_move_and_retitle_rewrites_every_form() {
        let root = fixture("all");
        let db = Db::open(&root).unwrap();
        index::index_vault(&root, &db).unwrap();
        let before_untouched = read(&root, "notes/other/untouched.md");

        let report = rename_note(&root, &db, "notes/plan.md", "notes/archive/big-plan.md", Some("Big Plan")).unwrap();
        assert!(!root.join("notes/plan.md").exists());
        assert_eq!(report.rewritten, ["notes/archive/big-plan.md", "notes/refs.md"]);
        assert!(!report.committed, "no git repo, nothing to commit");
        assert_eq!(report.commit_message(), "Rename notes/plan.md → notes/archive/big-plan.md (2 notes relinked)");

        let moved = read(&root, "notes/archive/big-plan.md");
        assert!(moved.starts_with("---\ntags:\n- a\ntitle: Big Plan\n---"), "title set, keys stay sorted: {moved}");
        assert!(moved.contains("See [[Big Plan#Goals]] (self)."), "self link follows: {moved}");

        let refs = read(&root, "notes/refs.md");
        assert!(refs.contains("By title [[Big Plan]], [[Big Plan|our plan]], [[Big Plan#Goals]], [[Big Plan#Goals|goals]]."), "{refs}");
        assert!(refs.contains("By stem [[big-plan]] and ![[big-plan#Goals]]. By path [[notes/archive/big-plan]] and [[notes/archive/big-plan.md]]."), "{refs}");
        assert!(refs.contains("Not it: [[Planning]] and [[Other]]."), "{refs}");
        assert_eq!(read(&root, "notes/other/untouched.md"), before_untouched);

        // The index followed: backlinks of the new path, none of the old.
        let mut back: Vec<String> = db.get_backlinks("notes/archive/big-plan.md").unwrap().into_iter().map(|n| n.path).collect();
        back.sort();
        assert_eq!(back, ["notes/refs.md"]);
        let notes = vault::list_notes(&root);
        assert_eq!(vault::resolve(&notes, "Big Plan").map(|n| n.path.as_str()), Some("notes/archive/big-plan.md"));
        assert!(vault::resolve(&notes, "The Plan").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn move_only_touches_path_links() {
        let root = fixture("move");
        let db = Db::open(&root).unwrap();
        index::index_vault(&root, &db).unwrap();

        let report = rename_note(&root, &db, "notes/plan.md", "notes/archive/plan.md", None).unwrap();
        assert_eq!(report.rewritten, ["notes/refs.md"]);
        assert_eq!(report.new_title, "The Plan");
        let refs = read(&root, "notes/refs.md");
        assert!(refs.contains("By title [[The Plan]], [[the plan|our plan]]"), "title links untouched: {refs}");
        assert!(refs.contains("By stem [[plan]] and ![[plan#Goals]]. By path [[notes/archive/plan]] and [[notes/archive/plan.md]]."), "{refs}");
        assert!(read(&root, "notes/archive/plan.md").contains("title: The Plan"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn title_change_alone_and_errors() {
        let root = fixture("title");
        let db = Db::open(&root).unwrap();
        index::index_vault(&root, &db).unwrap();

        // The editor path: title already saved, links fixed afterwards.
        let report = title_changed(&root, &db, "notes/plan.md", "The Plan", "Roadmap").unwrap();
        assert_eq!(report.rewritten, ["notes/plan.md", "notes/refs.md"]);
        assert_eq!(report.commit_message(), "Rename 'The Plan' → 'Roadmap' (2 notes relinked)");
        let refs = read(&root, "notes/refs.md");
        assert!(refs.contains("By title [[Roadmap]], [[Roadmap|our plan]], [[Roadmap#Goals]], [[Roadmap#Goals|goals]]."), "{refs}");
        assert!(refs.contains("By stem [[plan]] and ![[plan#Goals]]. By path [[notes/plan]]"), "stem and path links stay: {refs}");
        // No-ops report nothing.
        assert!(title_changed(&root, &db, "notes/plan.md", "Roadmap", "Roadmap").unwrap().rewritten.is_empty());
        assert!(title_changed(&root, &db, "notes/plan.md", "", "X").unwrap().rewritten.is_empty());

        assert!(rename_note(&root, &db, "notes/missing.md", "notes/x.md", None).is_err());
        assert!(rename_note(&root, &db, "notes/plan.md", "notes/refs.md", None).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_ambiguous_title_is_left_alone() {
        let root = fixture("ambiguous");
        std::fs::write(root.join("notes/other/twin.md"), "---\ntitle: the plan\n---\n\nSame title.\n").unwrap();
        let db = Db::open(&root).unwrap();
        index::index_vault(&root, &db).unwrap();

        let report = rename_note(&root, &db, "notes/plan.md", "notes/plan.md", Some("Big Plan")).unwrap();
        assert!(report.rewritten.is_empty(), "[[The Plan]] could mean the twin, so it stays");
        assert!(read(&root, "notes/plan.md").contains("title: Big Plan"));
        assert!(read(&root, "notes/refs.md").contains("By title [[The Plan]]"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn auto_commit_makes_one_commit_per_rename() {
        let root = fixture("commit");
        std::fs::create_dir_all(root.join(".cortex")).unwrap();
        std::fs::write(root.join(".cortex/settings.yaml"), "auto_commit: true\n").unwrap();
        std::fs::write(root.join(".gitignore"), ".brain/\n").unwrap();
        let repo = git::open_or_init(&root).unwrap();
        git::stage_all_and_commit(&repo, "Initial").unwrap();
        let db = Db::open(&root).unwrap();
        index::index_vault(&root, &db).unwrap();

        let report = rename_note(&root, &db, "notes/plan.md", "notes/roadmap.md", Some("Roadmap")).unwrap();
        assert!(report.committed);
        let log = git::get_log(&repo, 5).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].message.trim(), "Rename notes/plan.md → notes/roadmap.md (2 notes relinked)");
        let st = git::get_status(&repo).unwrap();
        assert!(st.staged.is_empty() && st.unstaged.is_empty() && st.untracked.is_empty(), "everything the rename touched is in that commit: {st:?}");

        std::fs::write(root.join(".cortex/settings.yaml"), "auto_commit: false\n").unwrap();
        let report = rename_note(&root, &db, "notes/roadmap.md", "notes/plan.md", None).unwrap();
        assert!(!report.committed);
        assert_eq!(git::get_log(&repo, 5).unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(&root);
    }
}
