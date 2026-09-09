# Vault Structure

Documents the conventions for what lives where in a Second Brain vault.

## Overview

A vault is a plain git repository. The app enforces minimal structure — it
creates three top-level directories and otherwise stays out of the way.

```
my-vault/
├── notes/           ← All user notes (see below)
├── templates/       ← Note templates
├── .brain/          ← App metadata (gitignored)
└── VAULT.md         ← Vault conventions, written on first open
```

## `notes/`

Every note the user creates lives here. The user controls the folder
structure entirely — create subdirectories freely via the `+` button in
the left panel.

**Convention** (not enforced):
- `notes/journal/YYYY-MM-DD.md` — daily notes (created by the Today button)
- `notes/work/`, `notes/personal/`, etc. — any grouping that suits the user

**Comments** on a note live beside it, never in it: `notes/foo.comments.yaml`
is a committed list of threads on `notes/foo.md`, each anchored to a quoted
passage (`quote` + which `occurrence`), with author (git identity), `created`,
`resolved` and `replies`. The sidecar is not a note — it is never indexed,
listed or published — and it moves with the note on rename.

Empty directories are tracked via `.gitkeep` files so git preserves them.

## `templates/`

Template files are plain `.md` files. Any file here appears as a template
option when creating a new note. The user owns all templates; the app
never writes default templates.

**Special file**: `templates/daily.md` — used automatically by the Today
button if it exists. Supports `{{date}}` and `{{title}}` variable substitution.

## `.brain/`

App-managed metadata. Always gitignored. Safe to delete at any time —
the app rebuilds it by scanning the vault on next open.

| File | Description |
|------|-------------|
| `index.db` | SQLite database: full-text search (FTS5), note entries, link graph |
| `settings.yaml` | Per-vault settings (not yet implemented) |

## `VAULT.md`

Written once on first vault open. Documents the vault structure and
conventions for the user. Edit freely — the app never overwrites it.

## Note format

Every note is a Markdown file with optional YAML frontmatter:

```markdown
---
title: My Note
type: note
tags: [ideas, project-x]
created: 2024-01-15
---

Body text. [[Link to another note]] works here.
```

Frontmatter keys are always sorted alphabetically (`created`, `tags`,
`title`, `type`) to keep git diffs clean.

The body is GitHub-flavoured Markdown. Formatting that GFM has no syntax
for uses the same conventions Obsidian and GitHub already render, so the
file stays legible without the app:

| In the editor | In the file |
|---|---|
| Callout | `> [!tip] text` |
| Toggle | `<details><summary>Title</summary>` … `</details>` |
| Toggle heading | `<details><summary><h2>Title</h2></summary>` … `</details>` |
| Highlight | `==text==` |
| Underline | `<u>text</u>` |
| Resized image | `<img src="assets/pic.png" alt="pic" width="480">` |
| Database view | a `cortex-view` fenced block |

Text colour has no file form and is not saved.
