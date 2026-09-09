//! Comments — discussion about a note that never touches the note.
//!
//! Threads live in a committed sidecar beside the note, `notes/foo.md` →
//! `notes/foo.comments.yaml`, so the Markdown stays clean for every other
//! reader and the discussion still syncs, diffs and merges like everything
//! else in the vault. The sidecar is not a note: it is never indexed, never
//! listed, and never published.
//!
//! ```yaml
//! - anchor:
//!     quote: the passage being discussed
//!   author: Diyahir
//!   created: 2026-09-09T14:03:00Z
//!   id: 7f3a9c1e
//!   replies:
//!     - author: Sam
//!       created: 2026-09-09T15:10:00Z
//!       text: Still true as of last week.
//!   resolved: true
//!   text: Is this still true?
//! ```
//!
//! An anchor is a text quote plus which occurrence of it is meant
//! (`occurrence`, 0 = the first, omitted when 0). Nothing positional is
//! stored, so the anchor survives edits elsewhere in the note; if the quoted
//! passage itself is deleted the thread simply stops pointing anywhere and is
//! shown as a note-level comment. A thread with no anchor is about the note
//! as a whole. Keys are alphabetical, the same convention as frontmatter.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

/// Where in the note a thread points: the nth exact occurrence of `quote`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Anchor {
    pub quote: String,
    /// 0 = the first occurrence of `quote` in the body.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub occurrence: usize,
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// A reply inside a thread.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reply {
    pub author: String,
    pub created: String,
    pub text: String,
}

/// One discussion: the opening comment, where it points, and its replies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Thread {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<Anchor>,
    pub author: String,
    /// ISO-8601 UTC, to the second.
    pub created: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub replies: Vec<Reply>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub resolved: bool,
    pub text: String,
}

/// `notes/foo.md` → `notes/foo.comments.yaml`.
pub fn sidecar_path(note_path: &str) -> String {
    let base = note_path.strip_suffix(".md").unwrap_or(note_path);
    format!("{base}.comments.yaml")
}

/// The note a sidecar belongs to, if `rel` is one: `notes/foo.comments.yaml`
/// → `notes/foo.md`.
pub fn note_for_sidecar(rel: &str) -> Option<String> {
    rel.strip_suffix(".comments.yaml").map(|base| format!("{base}.md"))
}

fn sidecar_abs(root: &Path, note_path: &str) -> PathBuf {
    root.join(sidecar_path(note_path))
}

/// Every thread on a note, in the order they were opened. No sidecar = none.
pub fn load(root: &Path, note_path: &str) -> Result<Vec<Thread>> {
    let path = sidecar_abs(root, note_path);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path)?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    Ok(serde_yaml::from_str(&content)?)
}

/// Write the threads back. An empty list removes the sidecar, so a note
/// whose discussion is gone carries no empty file.
pub fn save(root: &Path, note_path: &str, threads: &[Thread]) -> Result<()> {
    let path = sidecar_abs(root, note_path);
    if threads.is_empty() {
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_yaml::to_string(threads)?)?;
    Ok(())
}

/// Threads that are still open.
pub fn unresolved(threads: &[Thread]) -> usize {
    threads.iter().filter(|t| !t.resolved).count()
}

/// Byte range of the anchored passage in `body`, if the quote is still there.
pub fn locate(body: &str, anchor: &Anchor) -> Option<(usize, usize)> {
    if anchor.quote.is_empty() {
        return None;
    }
    body.match_indices(&anchor.quote).nth(anchor.occurrence).map(|(i, m)| (i, i + m.len()))
}

/// Which occurrence of `quote` starts at byte `offset` of `body` — the anchor
/// for a selection the caller has already located.
pub fn occurrence_at(body: &str, quote: &str, offset: usize) -> usize {
    if quote.is_empty() {
        return 0;
    }
    body.match_indices(quote).take_while(|(i, _)| *i < offset).count()
}

/// Who is writing: the git identity, else the login, else `anonymous`.
pub fn author(root: &Path) -> String {
    let user = crate::members::current_user(root);
    if !user.name.is_empty() {
        return user.name;
    }
    if !user.email.is_empty() {
        return user.email;
    }
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "anonymous".into())
}

fn now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// A short id that no thread on this note already uses.
fn new_id(threads: &[Thread], seed: &str) -> String {
    let mut n = 0u64;
    loop {
        let mut h = DefaultHasher::new();
        seed.hash(&mut h);
        now().hash(&mut h);
        std::process::id().hash(&mut h);
        n.hash(&mut h);
        let id = format!("{:08x}", h.finish() as u32);
        if !threads.iter().any(|t| t.id == id) {
            return id;
        }
        n += 1;
    }
}

fn clean(text: &str) -> Result<String> {
    let t = text.trim();
    if t.is_empty() {
        return Err(AppError::Other("A comment needs some text".into()));
    }
    Ok(t.to_string())
}

/// Open a thread. `anchor` is where it points (none = the whole note);
/// `author` defaults to the git identity.
pub fn add(root: &Path, note_path: &str, anchor: Option<Anchor>, text: &str, author: Option<&str>) -> Result<Thread> {
    let text = clean(text)?;
    let mut threads = load(root, note_path)?;
    let thread = Thread {
        id: new_id(&threads, &text),
        anchor: anchor.filter(|a| !a.quote.is_empty()),
        author: author.map(str::to_string).unwrap_or_else(|| self::author(root)),
        created: now(),
        text,
        resolved: false,
        replies: Vec::new(),
    };
    threads.push(thread.clone());
    save(root, note_path, &threads)?;
    Ok(thread)
}

fn find_mut<'a>(threads: &'a mut [Thread], id: &str) -> Result<&'a mut Thread> {
    threads.iter_mut().find(|t| t.id == id).ok_or_else(|| AppError::Other(format!("No comment thread '{id}'")))
}

/// Reply inside a thread. Replying to a resolved thread reopens it.
pub fn reply(root: &Path, note_path: &str, id: &str, text: &str, author: Option<&str>) -> Result<Thread> {
    let text = clean(text)?;
    let mut threads = load(root, note_path)?;
    let thread = find_mut(&mut threads, id)?;
    thread.replies.push(Reply {
        author: author.map(str::to_string).unwrap_or_else(|| self::author(root)),
        created: now(),
        text,
    });
    thread.resolved = false;
    let updated = thread.clone();
    save(root, note_path, &threads)?;
    Ok(updated)
}

/// Mark a thread resolved (or open again with `resolved = false`).
pub fn resolve(root: &Path, note_path: &str, id: &str, resolved: bool) -> Result<Thread> {
    let mut threads = load(root, note_path)?;
    let thread = find_mut(&mut threads, id)?;
    thread.resolved = resolved;
    let updated = thread.clone();
    save(root, note_path, &threads)?;
    Ok(updated)
}

/// Delete a thread outright.
pub fn delete(root: &Path, note_path: &str, id: &str) -> Result<()> {
    let mut threads = load(root, note_path)?;
    let before = threads.len();
    threads.retain(|t| t.id != id);
    if threads.len() == before {
        return Err(AppError::Other(format!("No comment thread '{id}'")));
    }
    save(root, note_path, &threads)
}

/// Move a note's sidecar along with the note. Nothing to do when the note
/// had no comments.
pub fn rename(root: &Path, old_note: &str, new_note: &str) -> Result<()> {
    let from = sidecar_abs(root, old_note);
    if old_note == new_note || !from.is_file() {
        return Ok(());
    }
    let to = sidecar_abs(root, new_note);
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(from, to)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("cortex-comments-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/plan.md"), "---\ntitle: Plan\n---\n\nShip it. Ship it again.\n").unwrap();
        root
    }

    #[test]
    fn sidecar_paths() {
        assert_eq!(sidecar_path("notes/a/plan.md"), "notes/a/plan.comments.yaml");
        assert_eq!(note_for_sidecar("notes/a/plan.comments.yaml"), Some("notes/a/plan.md".into()));
        assert_eq!(note_for_sidecar("notes/a/plan.md"), None);
        assert_eq!(note_for_sidecar(".cortex/settings.yaml"), None);
    }

    #[test]
    fn add_reply_resolve_round_trip() {
        let root = fixture("round-trip");
        assert!(load(&root, "notes/plan.md").unwrap().is_empty());

        let anchor = Anchor { quote: "Ship it".into(), occurrence: 1 };
        let t = add(&root, "notes/plan.md", Some(anchor.clone()), "  Really?  ", Some("Ada")).unwrap();
        assert_eq!(t.text, "Really?");
        assert_eq!(t.author, "Ada");
        assert_eq!(t.anchor, Some(anchor));
        assert!(!t.resolved);
        assert_eq!(t.id.len(), 8);

        let whole = add(&root, "notes/plan.md", None, "Note-level", Some("Ada")).unwrap();
        assert_ne!(whole.id, t.id);
        assert!(whole.anchor.is_none());

        let r = reply(&root, "notes/plan.md", &t.id, "Yes.", Some("Bob")).unwrap();
        assert_eq!(r.replies.len(), 1);
        assert_eq!(r.replies[0].author, "Bob");

        let done = resolve(&root, "notes/plan.md", &t.id, true).unwrap();
        assert!(done.resolved);
        let threads = load(&root, "notes/plan.md").unwrap();
        assert_eq!(threads.len(), 2);
        assert_eq!(unresolved(&threads), 1);

        // The file reads as the documented shape, keys alphabetical, defaults omitted.
        let yaml = std::fs::read_to_string(root.join("notes/plan.comments.yaml")).unwrap();
        assert!(yaml.starts_with("- anchor:\n    quote: Ship it\n    occurrence: 1\n  author: Ada\n  created: "), "{yaml}");
        assert!(yaml.contains("  resolved: true\n  text: Really?\n"), "{yaml}");
        assert!(!yaml.contains("  resolved: false"), "{yaml}");
        assert!(!yaml.contains("replies: []"), "{yaml}");

        // Replying reopens.
        let again = reply(&root, "notes/plan.md", &t.id, "One more thing", Some("Bob")).unwrap();
        assert!(!again.resolved);

        assert!(reply(&root, "notes/plan.md", "nope", "x", None).is_err());
        assert!(add(&root, "notes/plan.md", None, "   ", None).is_err());

        delete(&root, "notes/plan.md", &t.id).unwrap();
        delete(&root, "notes/plan.md", &whole.id).unwrap();
        assert!(!root.join("notes/plan.comments.yaml").exists(), "empty sidecar is removed");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn anchors_find_the_nth_occurrence() {
        let body = "Ship it. Ship it again.";
        assert_eq!(locate(body, &Anchor { quote: "Ship it".into(), occurrence: 0 }), Some((0, 7)));
        assert_eq!(locate(body, &Anchor { quote: "Ship it".into(), occurrence: 1 }), Some((9, 16)));
        assert_eq!(locate(body, &Anchor { quote: "Ship it".into(), occurrence: 2 }), None);
        assert_eq!(locate(body, &Anchor { quote: "gone".into(), occurrence: 0 }), None);
        assert_eq!(locate(body, &Anchor { quote: String::new(), occurrence: 0 }), None);
        assert_eq!(occurrence_at(body, "Ship it", 0), 0);
        assert_eq!(occurrence_at(body, "Ship it", 9), 1);
        assert_eq!(occurrence_at(body, "Ship it", 20), 2);
    }

    #[test]
    fn sidecar_follows_a_rename() {
        let root = fixture("rename");
        add(&root, "notes/plan.md", None, "Hi", Some("Ada")).unwrap();
        std::fs::create_dir_all(root.join("notes/archive")).unwrap();
        rename(&root, "notes/plan.md", "notes/archive/old-plan.md").unwrap();
        assert!(!root.join("notes/plan.comments.yaml").exists());
        assert_eq!(load(&root, "notes/archive/old-plan.md").unwrap().len(), 1);
        // No sidecar, no error.
        rename(&root, "notes/none.md", "notes/other.md").unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sidecar_is_not_a_note_and_is_not_published() {
        let root = fixture("hidden");
        std::fs::write(root.join("notes/plan.md"), "---\ntitle: Plan\npublish: true\n---\n\nShip it.\n").unwrap();
        add(&root, "notes/plan.md", Some(Anchor { quote: "Ship it".into(), occurrence: 0 }), "Secret opinion", Some("Ada")).unwrap();

        let listed: Vec<String> = crate::vault::list_notes(&root).into_iter().map(|n| n.path).collect();
        assert_eq!(listed, ["notes/plan.md"]);

        let db = crate::db::Db::open(&root).unwrap();
        crate::index::index_vault(&root, &db).unwrap();
        let indexed: Vec<String> = db.list_notes().unwrap().into_iter().map(|n| n.path).collect();
        assert_eq!(indexed, ["notes/plan.md"]);

        let out = root.join("site");
        crate::publish::build(&root, &out, false).unwrap();
        let mut leaked = Vec::new();
        for e in walkdir::WalkDir::new(&out).into_iter().filter_map(|e| e.ok()) {
            let s = e.path().to_string_lossy().to_string();
            if e.file_name().to_string_lossy().contains("comments") { leaked.push(s.clone()); }
            if e.path().is_file() && std::fs::read_to_string(e.path()).map(|c| c.contains("Secret opinion")).unwrap_or(false) {
                leaked.push(s);
            }
        }
        assert!(leaked.is_empty(), "{leaked:?}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
