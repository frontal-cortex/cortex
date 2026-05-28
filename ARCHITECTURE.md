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
├── .brain/              # App metadata — gitignored by default
│   ├── index.db         # SQLite full-text + structured index (rebuilt from files)
│   └── schemas/         # JSON Schema definitions for note types
├── notes/               # Freeform notes (suggested, not required)
├── journal/             # Daily notes (suggested)
├── projects/            # Project notes (suggested)
└── *.md                 # Notes can live anywhere in the tree
```

The directory layout is a convention, not a constraint. Any `.md` file anywhere in the vault (outside `.brain/` and `.git/`) is a note.

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

`type` is how notes gain structured behavior (task lists, meeting notes, etc.). Type definitions live in `.brain/schemas/` as JSON Schema files. An app that doesn't know the schema still sees valid markdown.

### The `.brain/` Directory

`.brain/` is the app's private workspace inside the vault. It is gitignored by default and always safe to delete — the app rebuilds it by scanning the vault files. It is never the source of truth; the `.md` files are.

---

## Git Integration

### Vault as Repo

On first open, the app calls `git init` if the directory is not already a repo. Every note write can be auto-committed or held for manual commit — user preference.

### Sync

Sync is a pull-rebase followed by a push to `origin HEAD`. The app shells out to the system `git` binary for push/pull so that SSH agents, credential helpers, and OS keychain integrations work correctly. Internal git operations (status, commits, branch management) use `libgit2` via the `git2` Rust crate for cross-platform reliability.

### Conflict Strategy

Conflicts are surfaced to the user as a merge conflict in the note file — the same `<<<<<<<` markers you would see in any git merge. The app detects conflict markers and shows a resolution UI rather than silently failing.

---

## AI Agent Integration

Agents interact with the vault through git. The protocol is:

1. **Agent clones or fetches** the vault repo.
2. **Agent creates a branch** named `agent/<description>` (e.g. `agent/plan-project-x`).
3. **Agent commits changes** to notes on that branch.
4. **Agent pushes** the branch to the remote (or writes it locally if working in-process).
5. **App detects** `agent/*` branches and surfaces them as pending reviews.
6. **User reviews** the diff in the app's built-in diff view.
7. **User approves** (merge + delete branch) or **discards** (delete branch, no merge).

The agent needs only: git access + read/write to the vault directory. It does not need to know anything about the app, its API, or its data format beyond "Markdown files with YAML frontmatter."

### Configuring an Agent

Agents are configured per-vault in `.brain/agents.json` (not yet implemented). Each entry specifies the trigger (manual, schedule, webhook), the agent executable or API endpoint, and the permissions scope (read-only, can create notes, can modify existing notes, can delete).

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Desktop app | Tauri 2.0 | Native binary, much lighter than Electron, Rust backend, macOS/Windows/Android from one codebase |
| Frontend | React + TypeScript + Vite | Widest ecosystem for block editor libs, fast iteration |
| Block editor | BlockNote (planned) | Notion-style block UX, outputs clean Markdown, React-native |
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
