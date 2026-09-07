use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, Result};
use crate::git;

const VAULT_MD: &str = r#"# Vault

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
| `tags`    | List of tags for filtering.                        |
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

App settings live in `.cortex/settings.yaml` (created automatically if absent).
`.cortex/` is committed to git so your config travels with the vault; `.brain/`
is a gitignored cache you can delete at any time.

```yaml
auto_commit: false           # commit after every note save
default_note_type: note      # pre-filled type for new notes
journal_template: daily.md   # template used for Today / daily notes
theme: system                # light | dark | system
theme_file: ""               # follow a palette file, e.g. ~/.local/state/omarchy/current/theme/colors.toml
trash_retention_days: 30     # auto-prune trashed notes after N days (0 = never)
```
"#;

/// Append `entry` to the vault's `.gitignore` if not already present, creating
/// the file with a sensible header if it doesn't exist. Idempotent.
fn ensure_gitignored(root: &PathBuf, entry: &str) -> Result<()> {
    let gitignore = root.join(".gitignore");
    let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();

    let already = existing
        .lines()
        .map(|l| l.trim())
        .any(|l| l == entry || l == entry.trim_end_matches('/'));
    if already {
        return Ok(());
    }

    let mut out = existing;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    if out.is_empty() {
        out.push_str("# Cortex — rebuildable cache (safe to delete)\n");
    }
    out.push_str(entry);
    out.push('\n');
    out.push_str(".DS_Store\n");
    std::fs::write(&gitignore, out)?;
    Ok(())
}

#[derive(Debug, Default)]
pub struct VaultState(pub Mutex<Option<PathBuf>>);

#[derive(Debug, Default)]
pub struct DbState(pub Mutex<Option<Db>>);

#[derive(Debug, Serialize, Deserialize)]
pub struct VaultInfo {
    pub path: String,
    pub name: String,
    pub has_remote: bool,
}

#[tauri::command]
pub fn open_vault(
    app: tauri::AppHandle,
    path: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<VaultInfo> {
    let vault_path = PathBuf::from(&path);
    if !vault_path.exists() {
        return Err(AppError::Other(format!("Path does not exist: {path}")));
    }

    git::open_or_init(&vault_path)?;
    std::fs::create_dir_all(vault_path.join(".brain"))?;
    std::fs::create_dir_all(vault_path.join(".cortex"))?;
    std::fs::create_dir_all(vault_path.join("templates"))?;
    std::fs::create_dir_all(vault_path.join("notes"))?;

    // Ensure the rebuildable cache is gitignored. `.cortex/` (config) and
    // `.trash/` (soft-deletes) are intentionally committed.
    ensure_gitignored(&vault_path, ".brain/")?;

    // Write VAULT.md only when opening for the first time
    let vault_doc = vault_path.join("VAULT.md");
    if !vault_doc.exists() {
        std::fs::write(&vault_doc, VAULT_MD)?;
    }

    // Best-effort prune of expired trash, using the vault's retention setting.
    let retention = std::fs::read_to_string(vault_path.join(".cortex/settings.yaml"))
        .ok()
        .and_then(|c| serde_yaml::from_str::<crate::commands::config::Settings>(&c).ok())
        .unwrap_or_default()
        .trash_retention_days;
    let _ = crate::commands::trash::prune_expired(&vault_path, retention);

    // Open / migrate the SQLite index, then re-index all notes
    let db = Db::open(&vault_path)?;
    crate::commands::indexer::index_vault(&vault_path, &db)?;
    *db_state.0.lock().unwrap() = Some(db);

    let name = vault_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("vault")
        .to_string();

    let has_remote = git2::Repository::open(&vault_path)
        .map(|r| r.find_remote("origin").is_ok())
        .unwrap_or(false);

    crate::commands::recent::record_recent(&app, &vault_path);

    // Follow external edits (agents, editors, git) for as long as the vault is open.
    crate::watcher::start(&app, vault_path.clone())?;

    *state.0.lock().unwrap() = Some(vault_path);

    Ok(VaultInfo { path, name, has_remote })
}

/// Public template repo used as the starting point for a new vault.
const TEMPLATE_URL: &str = "https://github.com/frontal-cortex/vault-template.git";

/// Scaffold a brand-new vault at `path` from the template repo.
///
/// Clones the template, strips its git history (so the new vault is the
/// user's own repo and can never accidentally push to the public template),
/// then re-initialises a fresh repo with an initial commit. The caller is
/// expected to follow up with `open_vault(path)`.
#[tauri::command]
pub fn create_vault_from_template(path: String) -> Result<()> {
    let target = PathBuf::from(&path);

    // The destination must be empty — never clobber existing files.
    if target.exists() {
        let mut entries = std::fs::read_dir(&target)?;
        if entries.next().is_some() {
            return Err(AppError::Other(format!(
                "Directory is not empty: {path}"
            )));
        }
    } else {
        std::fs::create_dir_all(&target)?;
    }

    // Shell out to system git so we reuse the user's credentials / proxy
    // config (same approach as git_sync).
    let output = std::process::Command::new("git")
        .args(["clone", "--depth", "1", TEMPLATE_URL, "."])
        .current_dir(&target)
        .output()?;
    if !output.status.success() {
        return Err(AppError::Other(format!(
            "Failed to clone template: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    // Drop the template's history + origin so this becomes a clean,
    // independent repository owned by the user.
    std::fs::remove_dir_all(target.join(".git"))?;

    let repo = git::open_or_init(&target)?;
    // Best-effort initial commit. If the user has no git identity configured,
    // the repo is still valid and the app will index the working tree on open.
    let _ = git::stage_all_and_commit(&repo, "Initial vault from template");

    Ok(())
}

/// Close the open vault — clears the in-memory vault path and index handle so
/// the app returns to the landing screen (like signing out).
#[tauri::command]
pub fn close_vault(
    app: tauri::AppHandle,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    crate::watcher::stop(&app);
    *state.0.lock().unwrap() = None;
    *db_state.0.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub fn get_vault_info(state: State<'_, VaultState>) -> Result<Option<VaultInfo>> {
    let guard = state.0.lock().unwrap();
    let Some(ref path) = *guard else {
        return Ok(None);
    };

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("vault")
        .to_string();

    let has_remote = git2::Repository::open(path)
        .map(|r| r.find_remote("origin").is_ok())
        .unwrap_or(false);

    Ok(Some(VaultInfo {
        path: path.to_string_lossy().to_string(),
        name,
        has_remote,
    }))
}
