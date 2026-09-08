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
| `cortex init [DIR]` | create a new vault (bundled starter template, git initialised, docs + settings written) — works offline |
| `cortex publish [--out DIR \| --gh-pages \| --github-action]` | list, build, or push the site of notes marked `publish: true`; never runs on its own (see `docs/publishing.md`) |
| `cortex propose <name> [-m msg] [--all] <paths…>` | package changes for review |
| `cortex proposals` / `diff` / `apply` / `discard <name>` | manage proposals from the terminal |
| `cortex settings [get <key> \| set key=value… \| describe]` | read, edit, or explain `.cortex/settings.yaml` |
| `cortex agents` | which agent CLIs are installed (for `terminal_command`) |
| `cortex mcp` | serve all of the above over MCP (stdio) |

Every command takes `--json`. Errors go to stderr with exit code 1.

## The MCP server

`cortex mcp` speaks the Model Context Protocol over stdio and exposes the
same operations as tools: `list_notes`, `search`, `read_note`, `create_note`,
`write_note`, `set_properties`, `links`, `backlinks`, `list_collections`,
`query_collection`, `get_schema`, `status`, `propose`, `list_proposals`,
`proposal_diff`, `get_settings`, `set_settings`, `list_agents`, `list_published` (read-only — an agent can see what is marked public but cannot build or push a site). Its instructions block teaches the agent the vault's
conventions and the propose-for-review rule.

Claude Code:

```bash
claude mcp add cortex -- cortex mcp --vault ~/my-vault
```

Any other MCP client: run `cortex mcp --vault <dir>` as a stdio server.

## Configuration

Every app setting lives in one file, `.cortex/settings.yaml`, so an agent
can configure the app the same way it edits notes. The app writes the file
with **every key present** on first open (defaults filled in), and reloads it
live whenever it changes on disk — the vault watcher treats anything under
`.cortex/` as a config change — so an edit takes effect without a restart.

```bash
cortex settings                     # the whole file (--json for JSON)
cortex settings describe            # every key: default and meaning
cortex settings get keybindings     # one key; keybindings.<id> reads a single override
cortex settings set keybindings.toggle-sidebar=mod+shift+b
cortex settings set terminal_command=claude
```

`set` types each value for its key (booleans, numbers, strings, the
`keybindings` map), validates every key before writing anything, and prints
the resulting file. An unknown key is rejected with the list of valid ones.
An empty value clears a string or removes a `keybindings.<id>` override.

Over MCP the same operations are `get_settings` (returns the settings plus
the key descriptions) and `set_settings` (`properties`: an object of key →
value, merged the same way). `cortex agents` / `list_agents` report which
agent CLIs — `claude`, `hermes`, `openclaw`, `codex`, `gemini`, `opencode`,
`aider`, `goose`, `amp`, `copilot`, `pi` — are on `$PATH`, so an agent can
set `terminal_command` to one that exists. The app's terminal pane (Ctrl+L)
then opens straight into that agent, with the shell underneath for when it
exits.

| Key | Meaning |
|---|---|
| `auto_commit` | commit after every note save, debounced (`true` / `false`, default `true`) |
| `default_note_type` | frontmatter `type` for new notes (default `note`) |
| `journal_template` | template under `templates/` for daily notes (default `daily.md`) |
| `theme` | `light` / `dark` / `system` (default `system`) |
| `trash_retention_days` | days before trashed notes are pruned, `0` = never (default `30`) |
| `auto_sync_minutes` | minutes between automatic git syncs, `0` = off (default `0`) |
| `collab_url` | Yjs websocket relay for presence and co-editing, empty = off |
| `theme_file` | palette file to follow (Omarchy `colors.toml` shape, `~` expands), empty = use `theme` |
| `prose_font` | page typeface preset (`ysabeau`, `quattro`, `duo`, `recursive`, `alegreya`, `fraunces`, `crimson`, `serif`, `system`, `mono`) or any font-family |
| `prose_slant` | page tilt: empty (upright), degrees such as `4` / `8`, or `italic` |
| `keybindings` | shortcut overrides, id → keys (e.g. `toggle-sidebar: mod+shift+b`); ids live in `src/lib/keymap.ts` |
| `terminal_command` | command the terminal pane opens with — an agent CLI such as `claude`; empty = plain shell |
| `site_title` | title of the published site; empty = the vault folder's name |
| `site_home` | published note shown on the site's front page, e.g. `notes/about.md` |

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
