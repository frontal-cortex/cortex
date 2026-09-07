//! Vault discovery and listing — the parts of "open a vault" that don't need
//! an app: find the root, walk the notes, resolve a reference.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

use crate::note::{self, NoteEntry};

/// Written to a vault's root on first open (next to VAULT.md) so any agent
/// that lands in the folder knows the rules and the tools. Never overwritten.
pub const AGENTS_MD: &str = r#"# Working in this vault

This folder is a Cortex vault: Markdown notes with YAML frontmatter, tracked
by git. The files are the source of truth — the app is a lens on them and
follows every change you make on disk.

## Layout

- `notes/` — all notes, in whatever folders the owner likes. `notes/journal/` holds daily notes.
- `collections/<name>/` — a database: one note per row, properties in frontmatter, `_index.md` is the table.
- `templates/` — note templates (`{{date}}`, `{{time}}`, `{{title}}`, `{{uuid}}`).
- `.cortex/` — committed config: settings, property schemas, members. `.brain/` is a cache; ignore it.

## Rules

- Frontmatter keys are sorted alphabetically; `created` is `YYYY-MM-DD`; `tags` is a list.
  Prefer the tools below over editing YAML by hand — they keep files canonical so diffs stay clean.
- Link notes with `[[Title]]`. Links resolve by title, then by filename.
- Never write derived data (rollups, counts) into notes; the app computes it.

## Tools

The `cortex` CLI works from anywhere inside the vault (or `--vault DIR` / `CORTEX_VAULT`):

    cortex ls [dir] [--type t] [--tag t]     list notes            cortex search <words>
    cortex show <note> [--body]              print a note          cortex new <title> [--dir d] [--tag t] [--template x] [--body -]
    cortex set <note> key=value [key=]       edit properties       cortex write <note> < body.md
    cortex links <note> / backlinks <note>   the link graph        cortex collections / view <coll> [--filter ..] [--sort f]
    cortex schema [key]                      typed properties      cortex status
    cortex propose <name> [-m msg] <paths>   hand changes to the owner for review (see below)

Add `--json` to any command for machine output. `cortex mcp` serves the same
operations over the Model Context Protocol (stdio).

## Proposing changes

Small, obviously-right edits can be written directly — the owner sees them
immediately. Anything that deserves a look first goes through a proposal:

    cortex propose "Summarise week 36" -m "Weekly summary from journal" notes/journal/*.md notes/summaries/week-36.md

That moves those paths onto an `agent/summarise-week-36` branch and restores
the working tree, so nothing changes for the owner until they open the
proposal in the app, read the diff, and Apply or Discard it.
"#;

/// Directories the walkers never descend into: cache, git, trash, config.
pub const HIDDEN_DIRS: [&str; 4] = [".brain", ".git", ".trash", ".cortex"];

pub fn is_hidden_component(c: &std::path::Component<'_>) -> bool {
    matches!(c.as_os_str().to_str(), Some(d) if HIDDEN_DIRS.contains(&d))
}

/// Does `dir` look like a vault root? `.cortex/` or `VAULT.md` are the app's
/// own marks; `notes/` beside a `.git` is what a hand-made vault looks like.
pub fn is_vault_root(dir: &Path) -> bool {
    dir.join(".cortex").is_dir()
        || dir.join("VAULT.md").is_file()
        || (dir.join("notes").is_dir() && dir.join(".git").exists())
}

/// Walk up from `start` to the nearest vault root, like `git` finds `.git`.
pub fn find_root(start: &Path) -> Option<PathBuf> {
    let mut dir = Some(start.to_path_buf());
    while let Some(d) = dir {
        if is_vault_root(&d) {
            return Some(d);
        }
        dir = d.parent().map(Path::to_path_buf);
    }
    None
}

/// Every note in the vault, newest first, read from disk (not the index).
/// A file with unparseable frontmatter (e.g. a template with raw
/// `{{placeholder}}` values) still appears, with a filename-derived title.
pub fn list_notes(root: &Path) -> Vec<NoteEntry> {
    let mut entries = Vec::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let p = e.path();
            p.extension().and_then(|s| s.to_str()) == Some("md")
                && !p.components().any(|c| is_hidden_component(&c))
        })
    {
        let abs = entry.path();
        let rel = abs.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
        let Ok(content) = std::fs::read_to_string(abs) else { continue };

        let modified = abs
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let (title, note_type, icon, tags) = match note::parse_note(&rel, &content) {
            Ok(parsed) => {
                let title = note::infer_title(&parsed);
                let note_type = parsed.frontmatter.get("type").and_then(|v| v.as_str()).map(str::to_string);
                let icon = parsed.frontmatter.get("icon").and_then(|v| v.as_str()).map(str::to_string);
                let tags = parsed
                    .frontmatter
                    .get("tags")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                    .unwrap_or_default();
                (title, note_type, icon, tags)
            }
            Err(_) => {
                let title = Path::new(&rel)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled")
                    .to_string();
                (title, None, None, Vec::new())
            }
        };

        entries.push(NoteEntry { path: rel, title, note_type, icon, tags, modified });
    }

    entries.sort_by(|a, b| b.modified.cmp(&a.modified));
    entries
}

/// Resolve a reference the way the app resolves a `[[wiki link]]`: exact
/// path, then exact title (case-insensitive), then a filename-stem match.
pub fn resolve<'a>(notes: &'a [NoteEntry], target: &str) -> Option<&'a NoteEntry> {
    let lower = target.to_lowercase();
    notes
        .iter()
        .find(|n| n.path == target)
        .or_else(|| notes.iter().find(|n| n.title.to_lowercase() == lower))
        .or_else(|| {
            notes.iter().find(|n| {
                Path::new(&n.path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_lowercase().contains(&lower))
                    .unwrap_or(false)
            })
        })
}
