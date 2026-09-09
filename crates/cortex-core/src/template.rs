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

use std::path::{Path, PathBuf};

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
    check_target(root)?;
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

/// `root` must be an empty directory, or absent (then it is created).
fn check_target(root: &Path) -> Result<()> {
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
    Ok(())
}

/// Where a new vault's files come from.
#[derive(Debug, Clone, PartialEq)]
pub enum TemplateSource {
    /// The starter compiled into the binary.
    Bundled,
    /// A folder on disk — a vault, or a checkout of a template repository.
    Dir(PathBuf),
    /// A git repository: cloned shallowly, its history dropped, its files used.
    Repo(String),
}

/// Read a `--template` argument: an existing path is a folder; `owner/repo`
/// is that repository on GitHub; anything with a scheme, a `git@` prefix or a
/// `.git` suffix is a URL git understands. Empty means the bundled starter.
pub fn parse_source(spec: &str) -> Result<TemplateSource> {
    let s = spec.trim();
    if s.is_empty() {
        return Ok(TemplateSource::Bundled);
    }
    let p = Path::new(s);
    if p.is_dir() {
        return Ok(TemplateSource::Dir(p.to_path_buf()));
    }
    if s.contains("://") || s.starts_with("git@") || s.ends_with(".git") {
        return Ok(TemplateSource::Repo(s.to_string()));
    }
    let parts: Vec<&str> = s.split('/').collect();
    let word = |w: &str| !w.is_empty() && w.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if parts.len() == 2 && word(parts[0]) && word(parts[1]) {
        return Ok(TemplateSource::Repo(format!("https://github.com/{}/{}.git", parts[0], parts[1])));
    }
    Err(AppError::Other(format!("template `{s}` is not a folder, an owner/repo on GitHub, or a git URL")))
}

/// Write a new vault into `root` (empty or absent) from `source`. A template's
/// own `.git` and `.brain` are never copied: the new vault starts its own
/// history, like GitHub's "Use this template". `{{today}}` in notes becomes
/// the scaffold date, as in the bundled starter; note templates are left alone.
pub fn scaffold_from(source: &TemplateSource, root: &Path) -> Result<()> {
    match source {
        TemplateSource::Bundled => scaffold(root),
        TemplateSource::Dir(dir) => {
            check_target(root)?;
            copy_template(dir, root)
        }
        TemplateSource::Repo(url) => {
            check_target(root)?;
            let tmp = std::env::temp_dir().join(format!("cortex-template-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&tmp);
            let out = std::process::Command::new("git")
                .args(["clone", "--depth", "1", "--quiet", url])
                .arg(&tmp)
                .output()
                .map_err(|e| AppError::Other(format!("git is needed to fetch a template repository: {e}")))?;
            if !out.status.success() {
                let _ = std::fs::remove_dir_all(&tmp);
                return Err(AppError::Other(format!("could not clone {url}: {}", String::from_utf8_lossy(&out.stderr).trim())));
            }
            let copied = copy_template(&tmp, root);
            let _ = std::fs::remove_dir_all(&tmp);
            copied
        }
    }
}

/// Text files whose `{{today}}` is stamped on copy.
const STAMPED_EXT: [&str; 4] = ["md", "yaml", "yml", "txt"];

fn copy_template(src: &Path, root: &Path) -> Result<()> {
    let src = src.canonicalize()?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut files = 0usize;
    let walker = walkdir::WalkDir::new(&src).into_iter().filter_entry(|e| {
        let name = e.file_name().to_string_lossy();
        !(e.depth() == 1 && (name == ".git" || name == ".brain"))
    });
    for entry in walker {
        let entry = entry.map_err(|e| AppError::Other(format!("reading template: {e}")))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry.path().strip_prefix(&src).unwrap_or(entry.path());
        let dest = root.join(rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let ext = rel.extension().and_then(|e| e.to_str()).unwrap_or("");
        let under_templates = rel.starts_with("templates");
        if STAMPED_EXT.contains(&ext) && !under_templates {
            let text = std::fs::read_to_string(entry.path())?;
            std::fs::write(&dest, text.replace(TODAY, &today))?;
        } else {
            std::fs::copy(entry.path(), &dest)?;
        }
        files += 1;
    }
    if files == 0 {
        return Err(AppError::Other(format!("template has no files: {}", src.display())));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_sources_are_recognised() {
        assert_eq!(parse_source("").unwrap(), TemplateSource::Bundled);
        assert_eq!(parse_source("frontal-cortex/vault-template").unwrap(),
            TemplateSource::Repo("https://github.com/frontal-cortex/vault-template.git".into()));
        assert_eq!(parse_source("git@github.com:me/v.git").unwrap(), TemplateSource::Repo("git@github.com:me/v.git".into()));
        assert_eq!(parse_source("https://example.com/v").unwrap(), TemplateSource::Repo("https://example.com/v".into()));
        let here = std::env::temp_dir();
        assert_eq!(parse_source(here.to_str().unwrap()).unwrap(), TemplateSource::Dir(here.clone()));
        assert!(parse_source("not a repo").is_err());
    }

    #[test]
    fn scaffold_from_a_folder_copies_files_stamps_dates_and_drops_git() {
        let src = temp("src");
        std::fs::create_dir_all(src.join("notes/ideas")).unwrap();
        std::fs::create_dir_all(src.join(".git")).unwrap();
        std::fs::create_dir_all(src.join("templates")).unwrap();
        std::fs::write(src.join(".git/HEAD"), "ref: refs/heads/main").unwrap();
        std::fs::write(src.join("notes/hello.md"), "---\ntitle: Hello\ncreated: {{today}}\n---\nhi\n").unwrap();
        std::fs::write(src.join("templates/daily.md"), "---\ntitle: \"{{date}}\"\n---\n{{today}} stays\n").unwrap();
        std::fs::write(src.join(".gitignore"), ".brain/\n").unwrap();
        let dst = temp("dst");
        scaffold_from(&TemplateSource::Dir(src.clone()), &dst).unwrap();
        assert!(!dst.join(".git").exists(), "template history is not copied");
        let hello = std::fs::read_to_string(dst.join("notes/hello.md")).unwrap();
        assert!(!hello.contains(TODAY) && hello.contains("created: 20"), "{hello}");
        let daily = std::fs::read_to_string(dst.join("templates/daily.md")).unwrap();
        assert!(daily.contains("{{today}} stays"), "note templates are copied verbatim");
        assert!(dst.join(".gitignore").exists());
        assert!(scaffold_from(&TemplateSource::Dir(src.clone()), &dst).is_err(), "target must be empty");
        let _ = std::fs::remove_dir_all(&src);
        let _ = std::fs::remove_dir_all(&dst);
    }

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
