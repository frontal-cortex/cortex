//! Vault discovery and listing — the parts of "open a vault" that don't need
//! an app: find the root, walk the notes, resolve a reference.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

use crate::note::{self, NoteEntry};

/// Written to a vault's root on first open (next to VAULT.md) so any agent
/// that lands in the folder knows the rules and the tools. Never overwritten.
/// `VAULT.md` — the human-readable conventions reference the app (and
/// `cortex init`) writes into every vault on first open when absent. Kept
/// beside `AGENTS_MD` so both docs are versioned with the code they describe.
pub const VAULT_MD: &str = r#"# Vault

This vault is managed by [Second Brain](https://github.com/your-org/second-brain).
Your data is plain Markdown — readable anywhere, version-controlled with git.

---

## Directory structure

```
my-vault/
├── notes/                  ← All your notes. Organise into subdirectories freely.
│   ├── journal/            ← Example: a folder for daily notes (optional convention).
│   ├── work/               ← Create any folders you like via the + button in the app.
│   └── my-note-2024.md
├── templates/              ← Note templates. See Templates section below.
├── assets/                 ← Images & files, referenced from notes by relative path.
├── .trash/                 ← Soft-deleted notes (committed) so you can restore them.
├── .cortex/                ← Your config (committed, portable, human-readable YAML).
│   ├── settings.yaml      ← App settings.
│   └── favorites.yaml     ← Favorited notes.
├── .brain/                 ← Cache (gitignored). Safe to delete — rebuilt on open.
│   └── index.db           ← Full-text search index (SQLite).
└── VAULT.md                ← This file.
```

## Note format

Every note is a Markdown file with optional YAML frontmatter:

```markdown
---
title: My Note
type: note
tags: [ideas, project-x]
created: 2024-01-15
---

Note body here. Use [[Note Title]] to link to other notes.
```

### Frontmatter fields

| Field     | Description                                        |
|-----------|----------------------------------------------------|
| `title`   | Display name — used in search, links, and the UI.  |
| `type`    | Note type: `note`, `task`, `meeting`, or anything. |
| `tags`    | List of tags. `#tag` in the body counts too; `a/b` nests. |
| `created` | ISO date the note was created (YYYY-MM-DD).        |

Custom fields are fully supported — add any key/value pair you need.
Keys are always sorted alphabetically for clean git diffs.

## Wiki links

Type `[[` inside any note to link to another note by title:

```markdown
See my notes on [[Project Alpha]] and [[Meeting 2024-01-15]].
```

Links are resolved by `title` frontmatter, falling back to filename stem.
Backlinks (notes that link *to* the current note) are shown at the bottom of the editor.

## Templates

Place `.md` files in `templates/` to use as note templates.

**Special templates:**
- `templates/daily.md` — used when creating a journal entry via the Today button.

Supported variables: `{{date}}`, `{{time}}`, `{{title}}`, `{{uuid}}`.

Quote placeholders in frontmatter so the file stays valid YAML
(`title: "{{date}}"`, not `title: {{date}}`).

Example `templates/daily.md`:
```markdown
---
title: "{{date}}"
type: journal
tags: [journal]
---

## What happened today


## What I learned


## Tomorrow
```

## AI agent integration

Any AI agent that can read/write files and run git commands can propose changes:

1. Agent creates a branch named `agent/<description>`.
2. Agent commits note changes to that branch.
3. The app shows the branch as a pending **proposal**.
4. You review the diff and **Apply** (merge) or **Discard** (delete branch).

The agent never needs to know about the app — just git and Markdown.

## Publishing

Notes stay private unless you say otherwise. Add `publish: true` to a note's
frontmatter (or tag it `public`) to mark it for the site; that alone changes
nothing on the internet. Publishing is always your own act: **Publish site…**
in the command palette, or `cortex publish --out DIR` from a terminal. The
result is a plain folder of HTML you can put on any static host, or push to
GitHub Pages with `cortex publish --gh-pages`. Wiki links to notes you did
not publish become plain text on the site, so nothing private is revealed.

## Sync

The vault syncs to any standard git remote:

```bash
# Set up a remote once
git remote add origin git@github.com:you/my-vault.git
git push -u origin main
```

After that, use the sync button (↑↓) in the app to push/pull.
The sync button turns orange when you have unpushed or unpulled commits.

## Settings

All app settings live in one file, `.cortex/settings.yaml`. It is written with
every key on first open (so you — or an agent — always see the full schema),
and the app reloads it live whenever it changes on disk. `.cortex/` is
committed to git so your config travels with the vault; `.brain/` is a
gitignored cache you can delete at any time.

```yaml
auto_commit: true            # commit after every note save (debounced; off = commit by hand or on sync)
default_note_type: note      # pre-filled type for new notes
journal_template: daily.md   # template used for Today / daily notes
theme: system                # light | dark | system
trash_retention_days: 30     # auto-prune trashed notes after N days (0 = never)
auto_sync_minutes: 0         # minutes between automatic git syncs (0 = off)
collab_url: ''               # Yjs websocket relay, e.g. ws://host:1234 (empty = off)
theme_file: ''               # follow a palette file, e.g. ~/.local/state/omarchy/current/theme/colors.toml
prose_font: ''               # page typeface: ysabeau | quattro | duo | recursive | alegreya | fraunces | crimson | serif | system | mono | any font-family
prose_slant: ''              # page tilt: '' upright | 4 | 8 (degrees) | italic
keybindings: {}              # shortcut overrides, id → keys, e.g. {toggle-sidebar: mod+shift+b}
terminal_command: ''         # command the terminal pane (Ctrl+L) opens with, e.g. claude (empty = shell)
site_title: ''               # title of the published site (empty = the vault folder's name)
site_home: ''                # published note shown on the site's front page, e.g. notes/about.md
```

From the terminal: `cortex settings` prints the file, `cortex settings describe`
explains every key, and `cortex settings set key=value…` edits it with the
right types (`cortex settings set terminal_command=claude
keybindings.toggle-sidebar=mod+shift+b`). `cortex agents` lists which agent
CLIs are installed.
"#;

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
- A `#tag` in the body counts as a tag too (not in code, headings or URLs); `parent/child` nests. Never write derived tag lists back.
- The app shows `title` as the page heading and `created` under it — don't repeat either as an H1 or a first line in the body.
  Prefer the tools below over editing YAML by hand — they keep files canonical so diffs stay clean.
- Link notes with `[[Title]]` — also `[[Title#Section]]` and `[[Title|shown text]]`. Links resolve by path, then title, then filename stem.
  Rename or move with `cortex mv` (or `set title=`), never by hand: every inbound link is rewritten to follow.
- Never write derived data (rollups, counts) into notes; the app computes it.

## Tools

The `cortex` CLI works from anywhere inside the vault (or `--vault DIR` / `CORTEX_VAULT`):

    cortex ls [dir] [--type t] [--tag t]     list notes            cortex search <query>   ("phrase" -word OR tag:x type:x path:x)
    cortex tags                              tags with counts, nested by /
    cortex show <note> [--body]              print a note          cortex new <title> [--dir d] [--tag t] [--template x] [--body -]
    cortex set <note> key=value [key=]       edit properties       cortex write <note> < body.md
    cortex links <note> / backlinks <note>   the link graph        cortex collections / view <coll> [--filter ..] [--sort f] [--summary f=sum]
    cortex mv <note> <path-or-dir/> [--title t]   rename/move; inbound [[links]] are rewritten to follow
    cortex schema [key]                      typed properties      cortex status
    cortex schema rename <key> <old> <new>   rename a property everywhere (rows, views, rollups, formulas)
    cortex schema rm <key> <name>            delete a property everywhere (refused while a rollup or formula uses it)
    cortex settings [get k | set k=v.. | describe]   app settings   cortex agents
    cortex assets [--unused]                 files under assets/ with reference counts; --unused = orphans (never deletes)
    cortex import csv <file> --collection <c> [--dry-run]   a CSV as rows   cortex import markdown <dir> [--into n] [--dry-run]
    cortex import notion <zip> [--into n] [--dry-run]   a Notion export: pages, databases as collections, a report note
    cortex propose <name> [-m msg] <paths>   hand changes to the owner for review (see below)

Add `--json` to any command for machine output. `cortex mcp` serves the same
operations over the Model Context Protocol (stdio).

Filters (`--filter`, a view's `filter:`, MCP `run_view`): `field OP value`
joined by `and` / `or` (`and` binds tighter; parentheses group; `not`
negates). OP is `== != > >= < <= contains does_not_contain starts_with
ends_with`, `is_empty` / `is_not_empty`, `in [a, b]`, or `within 7d` for
dates (`-7d` = the past week; units d w m y). Values: `'quoted'`, numbers,
`true`, `@today`, `@today-7`, `@monday`, `@month`, `@me`.

## Settings

`.cortex/settings.yaml` is the one config file; every key is always present
and the app reloads it live when it changes. Edit it with
`cortex settings set key=value…` (typed per key; unknown keys are rejected):

    auto_commit           true | false — commit after every note save, debounced (default true)
    default_note_type     frontmatter `type` for new notes (default note)
    journal_template      template under templates/ for daily notes (default daily.md)
    theme                 light | dark | system (default system)
    trash_retention_days  days before trashed notes are pruned, 0 = never (default 30)
    auto_sync_minutes     minutes between automatic git syncs, 0 = off (default 0)
    collab_url            Yjs websocket relay for co-editing, empty = off
    theme_file            palette file to follow (Omarchy colors.toml shape), empty = use `theme`
    prose_font            page typeface preset (ysabeau, quattro, duo, recursive, alegreya, fraunces, crimson, serif, system, mono) or any font-family
    prose_slant           page tilt: empty (upright), degrees such as 4 or 8, or italic
    keybindings           shortcut overrides, id → keys; `cortex settings set keybindings.toggle-sidebar=mod+shift+b`
    terminal_command      command the app's terminal pane opens with (an agent CLI such as claude); empty = shell
    site_title            title of the published site; empty = the vault folder's name
    site_home             published note shown on the site's front page, e.g. notes/about.md; empty = list only

`cortex settings describe` prints this table with defaults; `cortex agents`
lists which agent CLIs (claude, hermes, openclaw, codex, …) are installed.

## Publishing

Nothing is published unless the owner does it. `publish: true` in a note's
frontmatter (or the `public` tag) only marks it as *eligible*; the site is
built when the owner runs `cortex publish --out DIR` (or `--gh-pages`) or
uses Publish in the app. Set the flag only when asked to; never build or
push a site yourself. `cortex publish` with no target lists what is marked.
Links from a published note to an unpublished one become plain text.

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

        let (title, note_type, icon, parent, tags) = match note::parse_note(&rel, &content) {
            Ok(parsed) => {
                let title = note::infer_title(&parsed);
                let note_type = parsed.frontmatter.get("type").and_then(|v| v.as_str()).map(str::to_string);
                let icon = parsed.frontmatter.get("icon").and_then(|v| v.as_str()).map(str::to_string);
                let parent = parsed.frontmatter.get("parent").and_then(|v| v.as_str()).map(str::to_string);
                let tags = crate::tags::note_tags(&parsed);
                (title, note_type, icon, parent, tags)
            }
            Err(_) => {
                let title = Path::new(&rel)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled")
                    .to_string();
                (title, None, None, None, Vec::new())
            }
        };

        entries.push(NoteEntry { path: rel, title, note_type, icon, parent, tags, modified });
    }

    entries.sort_by(|a, b| b.modified.cmp(&a.modified));
    entries
}

/// The vault's tag tree — frontmatter and inline `#tags` of every note,
/// nested by `/` with counts. Computed, never stored.
pub fn list_tags(root: &Path) -> Vec<crate::tags::TagNode> {
    let notes = list_notes(root);
    crate::tags::list_tags(notes.iter().map(|n| (n.path.as_str(), n.tags.as_slice())))
}

/// Resolve a reference the way the app resolves a `[[wiki link]]`: exact
/// path, then exact title (case-insensitive), then exact filename stem
/// (case-insensitive). `target` may be any written form — `Note`,
/// `Note|alias`, `Note#Section`, `[[Note#Section|alias]]` — only the note
/// part is matched. This is the one resolver: the app's click handler, the
/// CLI, the MCP server, embeds and the publisher all go through it.
pub fn resolve<'a>(notes: &'a [NoteEntry], target: &str) -> Option<&'a NoteEntry> {
    let target = crate::note::parse_wiki_link(target).target;
    if target.is_empty() {
        return None;
    }
    let lower = target.to_lowercase();
    let with_ext = format!("{target}.md");
    notes
        .iter()
        .find(|n| n.path == target || n.path == with_ext)
        .or_else(|| notes.iter().find(|n| n.title.to_lowercase() == lower))
        .or_else(|| notes.iter().find(|n| stem(&n.path).to_lowercase() == lower))
}

/// The filename without directory or extension: `notes/a/plan.md` → `plan`.
pub fn stem(path: &str) -> &str {
    Path::new(path).file_stem().and_then(|s| s.to_str()).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, title: &str) -> NoteEntry {
        NoteEntry { path: path.into(), title: title.into(), note_type: None, icon: None, parent: None, tags: vec![], modified: 0 }
    }

    #[test]
    fn resolve_ignores_alias_and_section() {
        let notes = vec![entry("notes/plan.md", "The Plan"), entry("notes/rapid-notes.md", "Rapid")];
        let plan = Some("notes/plan.md");
        let path = |t: &str| resolve(&notes, t).map(|n| n.path.as_str());
        assert_eq!(path("The Plan"), plan);
        assert_eq!(path("the plan|our plan"), plan);
        assert_eq!(path("The Plan#Goals"), plan);
        assert_eq!(path("[[The Plan#Goals|see goals]]"), plan);
        assert_eq!(path("![[plan#Goals]]"), plan);
        assert_eq!(path("notes/plan"), plan);
        assert_eq!(path("notes/plan.md"), plan);
        assert_eq!(path("#Goals"), None);
        assert_eq!(path("Nope"), None);
        // The stem step is an exact match: a fragment never lands on a longer filename.
        assert_eq!(path("rapid-notes"), Some("notes/rapid-notes.md"));
        assert_eq!(path("Rapid-Notes"), Some("notes/rapid-notes.md"));
        assert_eq!(path("rapid"), Some("notes/rapid-notes.md")); // by title
        assert_eq!(path("notes"), None);
        assert_eq!(path("api"), None);
    }
}
