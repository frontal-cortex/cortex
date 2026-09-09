# Second Brain

A local-first, Notion-style knowledge base where your data is a plain git repository.

## What makes this different

- **Your data is a git repo.** Every note is a Markdown file. Open the vault in any text editor and it makes sense. Push it to GitHub, a self-hosted Gitea instance, or a bare repo on a NAS — your choice.
- **Always human-readable.** YAML frontmatter, standard Markdown. No proprietary formats or binary databases. The app is a lens; the files are the truth.
- **AI agents are first-class.** The `cortex` CLI and `cortex mcp` server give agents the same semantics the app has; anything that deserves a look goes through `cortex propose`, which lands as a proposal you review — diff first — and apply or discard, the same way you'd review a pull request.
- **Local-first.** Works fully offline. Sync is explicit, not a background assumption.
- **Bring your own everything.** Storage, git host, AI provider. No required cloud services.

## Status

Usable daily. Notes, wiki links, backlinks, graph, databases with typed properties and views, templates, history and restore, trash, git sync with conflict resolution, team members, live collaboration over an optional relay, a filesystem watcher, desktop-palette theming, a CLI, an MCP server, publishing chosen notes as a static site (see [docs/publishing.md](docs/publishing.md)), and a template marketplace — note templates and databases installed as plain files, from the app, the CLI or an agent (see [docs/marketplace.md](docs/marketplace.md)).

## Tech stack

- [Tauri 2.0](https://tauri.app) — native app (macOS, Windows, Android)
- React + TypeScript + Vite — frontend
- [BlockNote](https://blocknote.dev) — Notion-style block editor
- `git2` (libgit2) — cross-platform git operations
- SQLite (bundled) + FTS5 — local full-text search index
- A Cargo workspace: `crates/cortex-core` (the vault model, shared), `crates/cortex-cli` (the `cortex` binary + MCP server), `src-tauri` (the app)

## Development

**Prerequisites:** Rust, Node 18+, and [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your platform.

```bash
# Install JS dependencies
npm install

# Run in development mode (hot reload)
npm run tauri dev

# Build for production
npm run tauri build

# The CLI / MCP server
cargo install --path crates/cortex-cli
```

## Vault structure

```
my-vault/
├── notes/           # Your notes, in any folders you like (starter: welcome.md, a tour/ of the features, ideas/, journal/, work/)
├── templates/       # Note templates; daily.md seeds the Today note
├── .cortex/         # Settings, favourites — committed YAML, so config travels with the vault
├── .brain/          # Cache (gitignored, always safe to delete): the SQLite index
├── VAULT.md         # Conventions, for people      ┐ written by the app on first open
└── AGENTS.md        # Conventions, for agents      ┘ and by `cortex init`
```

"New vault" in the app and `cortex init` create this layout offline, as a git
repository with an initial commit.

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

```bash
cortex init ~/my-vault                       # a new vault, offline — the same one the app's "New vault" makes
cortex init ~/my-vault --template frontal-cortex/vault-template   # …or from a template: owner/repo, git URL, or folder
cortex search "weekly review"                # same search the app has
cortex new "Week 36" --tag summary --body -  # same naming, sorted frontmatter
cortex propose "Summarise week 36" notes/summaries/week-36-2026-09-07.md
cortex settings set terminal_command=claude  # every app setting lives in .cortex/settings.yaml
cortex packs install tasks                   # a template pack (Markdown + YAML) from the marketplace; never overwrites your files
cortex tracker habits --log Exercise         # tick a habit; streaks and scores are computed, never stored
cortex publish --out ./site                  # a static site from the notes marked publish: true — never automatic
claude mcp add cortex -- cortex mcp --vault ~/my-vault
```

Direct writes show up in the app live. `propose` moves changes onto an
`agent/<name>` branch that appears in the sidebar as a proposal — you read the
diff, then Apply or Discard. Every vault also carries an `AGENTS.md` with the
rules and the cheatsheet. See [docs/agent-integration.md](docs/agent-integration.md).

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## License

MIT
