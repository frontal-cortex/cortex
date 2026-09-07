# Agent Integration

How AI agents work with a Cortex vault. Three doors, one set of semantics:
the `cortex` CLI, the `cortex mcp` server, and plain git — all built on
`cortex-core`, the same crate the app runs on, so an agent sees exactly what
the user sees: the same frontmatter rules, link resolution, and views.

## What lands where

An agent has two ways to change a vault, and the choice is the whole design:

| Change                                     | How                                 | The user sees                         |
|--------------------------------------------|-------------------------------------|---------------------------------------|
| Small and obviously right (fix a tag, add a link, file a capture) | write directly — CLI, MCP, or the file | it appear live; the app follows the filesystem |
| Anything that deserves a look first        | `propose` it                        | a **proposal** in the sidebar: diff first, then Apply / Discard |

`propose` commits the given paths onto an `agent/<name>` branch and restores
the working tree, so the user's copy is untouched until they decide. That is
the "review like a pull request" promise, made concrete.

## The `cortex` CLI

```bash
cargo install --path crates/cortex-cli     # puts `cortex` on PATH
cd ~/my-vault                              # or: --vault DIR / CORTEX_VAULT=DIR
```

| Command | Does |
|---|---|
| `cortex ls [dir] [--type t] [--tag t]` | list notes, newest first |
| `cortex search <words>` | full-text search (prefix match per word) |
| `cortex show <note> [--body]` | print a note — by path, title, or filename stem |
| `cortex new <title> [--dir d] [--type t] [--tag t]… [--template x] [--body -]` | create; prints the path |
| `cortex set <note> key=value… [key=]` | merge typed properties (`3`, `true`, `[a, b]`); `key=` removes |
| `cortex write <note> < body.md` | replace the body, keep the frontmatter |
| `cortex fmt [notes…]` | rewrite in canonical form (sorted keys) |
| `cortex links <note>` / `cortex backlinks <note>` | the link graph, resolved |
| `cortex collections` / `cortex view <coll> [--filter ..] [--sort f] [--columns a,b] [--limit n]` | query a database like the app's table |
| `cortex schema [key]` | typed properties for a collection or note type |
| `cortex status` | changed files, sync counts, recent commits, proposals |
| `cortex propose <name> [-m msg] [--all] <paths…>` | package changes for review |
| `cortex proposals` / `diff` / `apply` / `discard <name>` | manage proposals from the terminal |
| `cortex mcp` | serve all of the above over MCP (stdio) |

Every command takes `--json`. Errors go to stderr with exit code 1.

## The MCP server

`cortex mcp` speaks the Model Context Protocol over stdio and exposes the
same operations as tools: `list_notes`, `search`, `read_note`, `create_note`,
`write_note`, `set_properties`, `links`, `backlinks`, `list_collections`,
`query_collection`, `get_schema`, `status`, `propose`, `list_proposals`,
`proposal_diff`. Its instructions block teaches the agent the vault's
conventions and the propose-for-review rule.

Claude Code:

```bash
claude mcp add cortex -- cortex mcp --vault ~/my-vault
```

Any other MCP client: run `cortex mcp --vault <dir>` as a stdio server.

## `AGENTS.md`

The app writes an `AGENTS.md` into every vault on first open (next to
`VAULT.md`), so an agent that simply lands in the folder — a Claude Code
session, a cron job — finds the layout, the rules, and the command
cheatsheet. It is the user's file after that; edit it freely.

## Plain git

Everything above is sugar over git. An agent with only a shell can still:

```bash
git checkout -b agent/summarise-week-36
# … write notes/summaries/week-36.md (sorted frontmatter, [[links]]) …
git add -A && git commit -m "Summarise week 36"
git push origin agent/summarise-week-36     # or leave it local
```

The app lists `agent/*` branches — local, or on `origin` after a sync —
as proposals. Applying a remote-only proposal creates the local branch,
merges, and deletes both copies.

## Frontmatter conventions

```yaml
---
created: 2026-09-07      # ISO date
tags: [tag1, tag2]       # list
title: Note Title        # display name
type: note               # note type; also picks the property schema
---
```

Keys are kept **alphabetically sorted** so every writer produces identical
output and diffs stay clean. `cortex set` / `cortex fmt` / the MCP tools do
this for you; if you write files by hand, sort the keys.
