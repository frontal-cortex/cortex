# Architecture

## Core Philosophy

**Your data is a git repository.**

Everything else — the UI, the AI integrations, the sync — is built around that single invariant. Open your vault in any text editor and it makes sense. Push it to GitHub and you have a backup. Grep through it and you find things. Clone it on a new machine and you're running in seconds. The app is a lens on top of data that already belongs to you.

### Tenets

1. **Human-readable first.** Every note is a Markdown file. Frontmatter is plain YAML. Nothing is stored in a binary format that requires the app to interpret. If the app ceases to exist, your data is still fully usable.

2. **Git is the database.** Version history, branching, merging, conflict resolution, and remote sync are all git primitives. We don't reinvent them — we expose them.

3. **AI agents are first-class, not bolted on.** An agent that can read and write files and run git commands can participate in your second brain. It proposes changes on a branch; you review and merge or discard. The review UX is built into the app.

4. **Local-first.** The app works fully offline. Sync is an explicit action, not a background assumption. You choose where your remote is — GitHub, Gitea, a bare repo on a NAS, anywhere.

5. **Bring your own everything.** Your storage, your git host, your AI provider. The app ships with no required cloud services.

---

## Vault Structure

A vault is a directory that is also a git repository.

```
my-vault/
├── notes/               # All user notes live here — organise freely into subdirectories
│   ├── journal/         # Example: a folder for daily notes (user-created, not special)
│   ├── work/            # Example: any subdirectory structure the user chooses
│   └── *.md
├── templates/           # Note templates — any .md file here can seed a new note
├── .brain/              # App metadata — gitignored, always safe to delete
│   └── index.db         # SQLite FTS index rebuilt from the .md files
└── VAULT.md             # Vault conventions doc, written on first open
```

All user notes live under `notes/`. The app enforces no structure within that directory — users create folders freely via the UI. There are no special-cased subdirectories (no `journal/`, no `projects/`). The "Today" button creates `notes/journal/YYYY-MM-DD.md` by convention, but `journal/` is just a regular folder.

`templates/` holds template files. The app reads them when creating new notes but never writes to this directory on its own.

### Note Format

Every note is a Markdown file with optional YAML frontmatter:

```markdown
---
title: My Note
type: note
tags: [ideas, project-x]
created: 2024-01-15
---

Note body here. [[Wiki links]] work. So do standard markdown features.
```

`type` is how notes gain structured behavior (task lists, meeting notes, etc.). Property schemas live in `.cortex/schemas/<key>.yaml` — committed and portable, so they travel with the vault. A schema is keyed by collection name for notes under `collections/<name>/`, otherwise by the note's `type` (see `schema_key`). Each schema declares typed properties (text, number, date, checkbox, select, multi_select, status, url); the select-like types carry named options with colors. An app that doesn't know the schema still sees valid markdown.

### The `.brain/` Directory

`.brain/` is the app's private workspace inside the vault. It is gitignored by default and always safe to delete — the app rebuilds it by scanning the vault files. It is never the source of truth; the `.md` files are.

---

## Git Integration

### Vault as Repo

On first open, the app calls `git init` if the directory is not already a repo. Every note write can be auto-committed or held for manual commit — user preference.

### Sync

Sync is a pull-rebase followed by a push to `origin HEAD`. The app shells out to the system `git` binary for push/pull so that SSH agents, credential helpers, and OS keychain integrations work correctly. Internal git operations (status, commits, branch management) use `libgit2` via the `git2` Rust crate for cross-platform reliability.

### Conflict Strategy

Conflicts are surfaced to the user as a merge conflict in the note file — the same `<<<<<<<` markers you would see in any git merge. Sync uses `pull --no-rebase` (merge, not rebase) precisely so a conflict leaves ONE recoverable state. The app lists conflicted files in a resolution UI: keep mine / take theirs per file, or edit the markers by hand and mark resolved; then the merge is committed and pushed. A merge can always be aborted, restoring the pre-pull state.

---

## Multi-User Collaboration

Three layers, in order of how much infrastructure they need:

1. **Git sync (no infrastructure).** Auto-commit on save (debounced), auto-sync on launch/focus/interval, the conflict UI above. Each row of a database is its own file, so two people editing different rows never conflict. Identity is git identity (`user.name` / `user.email`) — the same name that authors commits.

2. **Members & assignment (a committed file).** `.cortex/members.yaml` is the team roster (name, email, color). A `person` property type draws its options from the roster; `@me` in a view filter resolves per-viewer, so one shared "Assigned to me" view works for everyone. Daily notes nest per user (`journal/<user>/…`).

3. **Real-time (a relay you bring).** An optional Yjs websocket relay (`collab_url` in settings; self-host with `npx y-websocket-server`, any $5 VPS or office machine). It carries three things, all ephemeral: presence (who is in which note), live co-editing of the open note (BlockNote's Yjs collaboration over a per-note room), and "something changed" nudges that trigger an immediate sync instead of waiting for the next interval. **The relay is never the source of truth**: co-edited sessions serialize through the normal markdown save path, files + git remain canonical, and if the relay is down the app degrades to the plain git workflow.

---

## AI Agent Integration

The vault model lives in `crates/cortex-core`; the app, the `cortex` CLI and
the `cortex mcp` server are thin layers over it. So an agent driving the CLI
or MCP tools gets the *same* semantics the user sees — frontmatter rules, link
resolution, typed properties, views — instead of re-deriving them from YAML.

Two kinds of change, by design:

- **Direct writes** (CLI, MCP tools, or the files themselves) land immediately;
  the app watches the filesystem and follows.
- **Proposals** — `cortex propose <name> <paths>` or the `propose` MCP tool —
  commit the given paths onto an `agent/<slug>` branch and restore the working
  tree. The app lists `agent/*` branches (local, or on `origin` after a sync)
  as proposals; the user opens one, reads the diff, and applies or discards it.
  Applying merges and deletes the branch (both copies, if it was pushed).

An agent with only git can do the same by hand: branch `agent/<name>`, commit,
optionally push. Every vault carries an `AGENTS.md` (written on first open,
the user's to edit) with the layout, rules and cheatsheet. See
[docs/agent-integration.md](docs/agent-integration.md).

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Desktop app | Tauri 2.0 | Native binary, much lighter than Electron, Rust backend, macOS/Windows/Android from one codebase |
| Frontend | React + TypeScript + Vite | Widest ecosystem for block editor libs, fast iteration |
| Block editor | BlockNote | Notion-style block UX, outputs clean Markdown, React-native |
| Git operations | `git2` (libgit2) | Cross-platform, no system git dependency for core ops, works on Android |
| Local index | SQLite (bundled) + FTS5 | Zero-config, fast full-text search, queryable frontmatter, works offline |
| Frontmatter | YAML via `serde_yaml` | Human-readable, wide tool support, de-facto standard for Markdown metadata |

### Why Not…

- **Electron**: 150MB+ runtime, higher memory footprint. Tauri ships a ~10MB binary.
- **Obsidian's sync**: Proprietary, requires their cloud. Git gives you the same capability with more control.
- **A real database as the source of truth**: The SQLite index is a cache derived from the files. Deleting it and restarting rebuilds it. The Markdown files own the data.
- **CRDT-based sync**: Adds significant complexity; git's merge semantics are sufficient for single-user and occasional-collaboration use cases. CRDTs can be revisited if real-time collaboration becomes a goal.

---

## Data Flow

```
User edits note
      │
      ▼
BlockNote (React)
      │  onChange → serialize to Markdown + frontmatter
      ▼
Tauri IPC: write_note
      │
      ▼
Rust: write .md file to vault
      │
      ├──▶ Auto-commit (if enabled): git2 stage + commit
      │
      └──▶ Update SQLite index: parse frontmatter → upsert note entry

User clicks Sync
      │
      ▼
Rust: shell out to `git pull --rebase origin HEAD`
      │
      ▼
Rust: shell out to `git push origin HEAD`
      │
      ▼
Re-index any changed files
```

---

## Future Considerations

- **Encryption**: `git-crypt` or per-file `age` encryption for private vaults pushed to public remotes. The file-per-note structure makes per-file encryption natural.
- **Full Android support**: Tauri 2.0 Mobile targets Android. The Rust core (git2, rusqlite) is cross-platform. The main gap is SSH key management on Android.
- **Plugin system**: Custom note types, custom views, custom sync providers — modeled as WASM plugins loaded by the Tauri backend.
- **Semantic search**: Embeddings generated locally (e.g. via `llama.cpp`) stored in SQLite's vector extension. Optional, never required.
- **Shared vaults**: Multi-user collaboration via standard git workflows (PRs, branches). The app already has the primitives.
