# Second Brain

A local-first, Notion-style knowledge base where your data is a plain git repository.

## What makes this different

- **Your data is a git repo.** Every note is a Markdown file. Open the vault in any text editor and it makes sense. Push it to GitHub, a self-hosted Gitea instance, or a bare repo on a NAS — your choice.
- **Always human-readable.** YAML frontmatter, standard Markdown. No proprietary formats or binary databases. The app is a lens; the files are the truth.
- **AI agents are first-class.** An agent proposes changes on a `agent/<name>` branch. You review the diff inside the app and approve or discard — the same way you'd review a pull request.
- **Local-first.** Works fully offline. Sync is explicit, not a background assumption.
- **Bring your own everything.** Storage, git host, AI provider. No required cloud services.

## Status

Early development. The Rust backend (git, SQLite index, note parsing) is scaffolded. UI is in progress.

## Tech stack

- [Tauri 2.0](https://tauri.app) — native app (macOS, Windows, Android)
- React + TypeScript + Vite — frontend
- [BlockNote](https://blocknote.dev) — Notion-style block editor
- `git2` (libgit2) — cross-platform git operations
- SQLite (bundled) + FTS5 — local full-text search index

## Development

**Prerequisites:** Rust, Node 18+, and [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your platform.

```bash
# Install JS dependencies
npm install

# Run in development mode (hot reload)
npm run tauri dev

# Build for production
npm run tauri build
```

## Vault structure

```
my-vault/
├── .brain/          # App metadata (gitignored, always safe to delete)
│   └── index.db     # SQLite index rebuilt from your files
├── notes/
├── journal/
└── *.md             # Notes can live anywhere
```

Notes use standard Markdown with optional YAML frontmatter:

```markdown
---
title: My Note
type: note
tags: [ideas]
---

Your content here. [[Wiki links]] supported.
```

## Agent integration

Any AI agent that can read/write files and run git commands can integrate with your vault:

1. Agent creates a branch: `agent/my-suggestion`
2. Agent commits changes to notes
3. App surfaces the branch as a pending review
4. You approve (merge) or discard

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## License

MIT
