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
├── notes/          ← All your notes live here. Organise into subdirectories freely.
├── journal/        ← Daily notes, one file per day (YYYY-MM-DD.md).
├── templates/      ← Note templates. See Templates section below.
├── .brain/         ← App metadata (gitignored). Safe to delete — rebuilt on open.
│   └── index.db   ← Full-text search index (SQLite).
└── VAULT.md        ← This file.
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

Supported variables: `{{date}}`, `{{title}}`

Example `templates/daily.md`:
```markdown
---
title: {{date}}
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

App settings live in `.brain/settings.yaml` (created automatically if absent):

```yaml
auto_commit: false          # commit after every note save
default_note_type: note     # pre-filled type for new notes
journal_template: daily.md  # template used for Today notes
```
"#;

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
    std::fs::create_dir_all(vault_path.join("templates"))?;
    std::fs::create_dir_all(vault_path.join("notes"))?;
    std::fs::create_dir_all(vault_path.join("journal"))?;

    // Write VAULT.md only when opening for the first time
    let vault_doc = vault_path.join("VAULT.md");
    if !vault_doc.exists() {
        std::fs::write(&vault_doc, VAULT_MD)?;
    }

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

    *state.0.lock().unwrap() = Some(vault_path);

    Ok(VaultInfo { path, name, has_remote })
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
