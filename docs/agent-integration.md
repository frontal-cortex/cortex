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
| `cortex ls [dir] [--type t] [--tag t]` | list notes, newest first; `--tag` sees frontmatter and inline `#tags`, and a parent matches its children |
| `cortex tags` | every tag with note counts, nested by `/` (`--json` keeps the tree) |
| `cortex search <query>` | full-text search: words prefix-match; `"exact phrase"`, `-excluded`, `a OR b`, `tag:x`, `type:x`, `path:x` (any filter negatable, `-tag:x`; quote the whole query when a word starts with `-`); each hit carries a body snippet with the match in `<mark>` |
| `cortex show <note> [--body]` | print a note — by path, title, or filename stem |
| `cortex new <title> [--dir d] [--type t] [--tag t]… [--template x] [--body -]` | create; prints the path |
| `cortex set <note> key=value… [key+=v] [key-=v] [key=]` | merge typed properties (`3`, `true`, `[a, b]`); `key+=v` / `key-=v` add to or remove from a list; `key=` removes. A missing `collections/<c>/<id>` row is created first from the collection's row template, so a tracker's day file needs no setup |
| `cortex tracker [<coll>] [--range today\|week\|month\|year] [--at DATE] [--view NAME]` | list the vault's tracker views, or print one as a grid with streaks, week counts and per-day scores (computed, never stored) |
| `cortex tracker <coll> --log <item> [--date DATE] [--off]` | tick (or untick) one item for a day and print its streak — `cortex tracker habits --log Exercise` |
| `cortex write <note> < body.md` | replace the body, keep the frontmatter |
| `cortex fmt [notes…]` | rewrite in canonical form (sorted keys) |
| `cortex links <note>` / `cortex backlinks <note>` | the link graph, resolved |
| `cortex mv <note> <dest> [--title t]` | rename or move a note — `dest` is a new path (`notes/x/plan.md`) or a folder (`notes/x/`) — and rewrite every inbound `[[link]]` to follow it, aliases / sections / embeds kept; one commit when `auto_commit` is on. `cortex set <note> title=…` relinks the same way |
| `cortex collections` / `cortex view <coll> [--filter ..] [--sort f] [--columns a,b] [--limit n] [--summary f=sum,g=count]` | query a database like the app's table; `--summary` adds the footer's calculations (count, sum, avg, min, max, percent_checked, empty, not_empty) |
| `cortex schema [key]` | typed properties for a collection or note type |
| `cortex schema rename <key> <old> <new>` / `cortex schema rm <key> <name>` | rename or delete a property everywhere at once: the schema, the key in every row, the collection's views, and the rollups / formulas (in any schema) that reference it. `rm` is refused while a rollup or formula still depends on the property, and says which |
| `cortex status` | changed files, sync counts, recent commits, proposals |
| `cortex init [DIR]` | create a new vault (bundled starter template, git initialised, docs + settings written) — works offline |
| `cortex publish [--out DIR \| --gh-pages \| --github-action]` | list, build, or push the site of notes marked `publish: true`; never runs on its own (see `docs/publishing.md`) |
| `cortex packs list [--tier t] [--installed] [--refresh]` / `show <id>` | browse template packs — bundled official ones plus any configured index (see `docs/marketplace.md`) |
| `cortex packs install <id> [--force] [--dry-run]` / `update [<id>]` / `remove <id>` | install into `templates/`, `.cortex/schemas/`, `collections/<name>/`, recorded in `.cortex/packs.yaml`; never overwrites a file you edited unless `--force`, and never a collection row |
| `cortex packs lint [DIR]` / `new <id> --from templates/x.md\|collections/y` / `index [DIR]` | author a pack from your own setup, check it against the format rules, regenerate a registry's `index.json` |
| `cortex import csv <file> --collection <name> [--title COL] [--map "Header=prop[:type]"]… [--dry-run]` | a CSV as rows of a collection (see [Importing](#importing)) |
| `cortex import markdown <dir> [--into NAME] [--dry-run]` | a folder of Markdown copied under `notes/<name>/`, images into `assets/`; the source is never modified |
| `cortex import notion <zip-or-dir> [--into NAME] [--dry-run]` | a Notion export in one go: pages, every database as a collection, images, and an import report note |
| `cortex propose <name> [-m msg] [--all] <paths…>` | package changes for review |
| `cortex proposals` / `diff` / `apply` / `discard <name>` | manage proposals from the terminal |
| `cortex settings [get <key> \| set key=value… \| describe]` | read, edit, or explain `.cortex/settings.yaml` |
| `cortex agents` | which agent CLIs are installed (for `terminal_command`) |
| `cortex mcp` | serve all of the above over MCP (stdio) |

Every command takes `--json`. Errors go to stderr with exit code 1.

## The MCP server

`cortex mcp` speaks the Model Context Protocol over stdio and exposes the
same operations as tools: `list_notes`, `list_tags`, `search`, `read_note`, `create_note`,
`write_note`, `set_properties`, `links`, `backlinks`, `list_collections`,
`query_collection`, `get_schema`, `rename_property`, `delete_property`, `status`, `propose`, `list_proposals`,
`proposal_diff`, `get_settings`, `set_settings`, `list_agents`, `list_packs`, `install_pack`,
`update_pack`, `remove_pack` (template packs — an agent asked to "set up a habit tracker" can
install one; every result is a plain file the user sees at once, and `.cortex/packs.yaml` makes it
undoable), `run_view` (any cortex-view spec), `tracker` and `track` (a tracker view's grid with
streaks, and ticking one item for a day — "I ran today" is one `track` call), `import_csv`,
`import_markdown` and `import_notion` (the importers below; all take `dry_run` so the agent can show
the plan before writing), `list_published` (read-only — an agent can see what is marked public but cannot build or
push a site). Its instructions block teaches the agent the vault's
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
| `journal_template` | what Today opens: a template under `templates/` (default `daily.md`), or `collections/<name>` to make Today that collection's row for the day |
| `theme` | `light` / `dark` / `system` (default `system`) |
| `trash_retention_days` | days before trashed notes are pruned, `0` = never (default `30`) |
| `auto_sync_minutes` | minutes between automatic git syncs, `0` = off (default `0`) |
| `collab_url` | Yjs websocket relay for presence and co-editing, empty = off |
| `theme_file` | palette file to follow (Omarchy `colors.toml` shape, `~` expands), empty = use `theme` |
| `accent` | action colour: empty = the theme's accent; a palette colour name (`blue`, `yellow`, …) or a `#hex` |
| `prose_font` | page typeface preset (`ysabeau`, `quattro`, `duo`, `recursive`, `alegreya`, `fraunces`, `crimson`, `serif`, `system`, `mono`) or any font-family |
| `prose_slant` | page tilt: empty (upright), degrees such as `4` / `8`, or `italic` |
| `keybindings` | shortcut overrides, id → keys (e.g. `toggle-sidebar: mod+shift+b`); ids live in `src/lib/keymap.ts` |
| `terminal_command` | command the terminal pane opens with — an agent CLI such as `claude`; empty = plain shell |
| `site_title` | title of the published site; empty = the vault folder's name |
| `site_home` | published note shown on the site's front page, e.g. `notes/about.md` |
| `marketplace_url` | template marketplace index URL; empty = the official one. A company points this at its own registry |
| `marketplace_extra` | additional index URLs, comma-separated, merged with the first (a team registry alongside the official one) |
| `marketplace_tiers` | trust tiers shown: `official`, `verified`, `community` (comma-separated); empty = all three |

## Views, filters and computed properties

Every collection view — in `_index.md`, in a `cortex-view` fence, in `cortex view`
and MCP `run_view` — shares one engine. What it understands:

**Filters.** `field OP value` joined by `and` / `or`; `and` binds tighter
than `or`, parentheses group, `not` negates what follows:
`(status == 'todo' or status == 'doing') and not owner is_empty`. Ops:
`== != > >= < <= contains does_not_contain starts_with ends_with`,
`is_empty` / `is_not_empty` (no value), `in [a, b]` (equal to any), and
`within 7d` for dates (today through today+7; `-7d` the past week; units
`d w m y`). Strings in single quotes; on a list property `contains` and `==`
mean "has that item". Values may be **relative dates**: `@today`, `@today-7`,
`@today+30`, `@tomorrow`, `@yesterday`, `@monday` (this week's), `@monday-1`,
`@sunday`, `@month` (`YYYY-MM`), `@month-1`, `@year`, `@week` (`YYYY-Www`), and
`@me` (the current member). An empty cell equals `''` and satisfies no ordering
comparison, so `due <= @today` never sweeps in undated rows.

**Summary row.** `summary: {amount: sum, done: percent_checked}` on a table
view computes one value per named field over the rows the view shows (after
filter and limit): `count`, `sum`, `avg`, `min`, `max`, `percent_checked`
(share of rows ticked, 0–100), `empty`, `not_empty`. The values come back as
`summary` from `cortex view --summary amount=sum` and MCP `run_view` /
`query_collection`; the app's footer shows the same numbers. A table with
`group: status` folds into one section per value, in option order.

**Sorting.** `sort: [due, priority desc]`. Empty cells sort last in either
direction. A select or status property sorts by its option order, not
alphabetically — `priority: [p1, p2, p3]` puts p1 first whatever the words are.
Charts over a select follow the same order.

**Computed properties** live in the schema (`.cortex/schemas/<collection>.yaml`)
and are computed on read, never written to a file. They are computed before a
view's filter and sort run, so `filter: progress < 100` and `sort: [days_left]`
work:

```yaml
properties:
  - name: milestones          # the reverse side of a relation: rows of
    type: relation            # `milestones` whose `project` names this row
    from: milestones
    relation: project
  - name: progress            # share of those rows matching `where`
    type: rollup
    from: milestones
    relation: project
    function: percent         # or count | sum | avg | min | max | values (+ property:)
    where: done == true
  - name: remaining           # a formula over this row's own properties
    type: formula
    expr: budget - spent
  - name: days_left
    type: formula
    expr: days_until(deadline)
  - name: completed           # a date stamped with today when the condition
    type: date                # first holds and the date is empty
    auto: status == done
  - name: spent
    type: number
    format: currency          # percent | progress (a 0–100 bar) | currency | stars | integer | decimal
    unit: "€"
```

Formulas know `+ - * / %`, comparisons, `and or not`, and `days_until(d)`,
`days_since(d)`, `days_between(a, b)`, `today()`, `year(d)`, `month(d)`,
`round(x, n)`, `abs`, `min`, `max`, `if(c, a, b)`, `coalesce`, `len`, `contains`,
`concat`, `lower`, `upper`, `empty`. A date minus a date is a number of days.

**Recurrence.** A row with `repeat: weekly` (`daily`, `biweekly`, `monthly`,
`quarterly`, `yearly`, `every 3 days`, `every 2 weeks`) comes back when it is
finished — its status set to the last option or a done-word, or a `done` /
`paid` checkbox ticked: every date property moves forward by the interval and
the result is written as a **new row** (history stays), or the same row is moved
forward with `repeat_mode: advance` (a bill's `next_due`). The trigger and any
auto-stamped dates are reset. This follows any edit to a collection row —
the app, `cortex set`, MCP `set_properties` — so an agent that marks a task
done creates next week's task.

**Date placeholders** in templates and seeds use the same words: `{{today}}`,
`{{today+7}}`, `{{monday}}`, `{{month}}`, `{{week}}`; row templates also get
`{{date}}` (the row's day) with offsets, `{{time}}`, `{{title}}`, `{{uuid}}`.

## Importing

Three importers, in `cortex-core` like everything else, so the app's Import
dialog, the CLI and the MCP tools do exactly the same thing. None writes
anything the source did not contain, and none overwrites a file that is
already there — a collision is reported as skipped.

**A CSV into a collection.** Every record becomes one row note under
`collections/<name>/`, named from the title column (`title` or `name` by
default, else the first column; `--title` picks another). The other columns
become frontmatter, typed by inference from the cells: numbers, `YYYY-MM-DD`
dates, `true`/`false` checkboxes, `http(s)://` URLs, and a text column with a
small repeated vocabulary (ten values or fewer, each used more than once on
average) becomes a select whose options are the values seen. Headers turn into
keys (`Due date` → `due_date`); `--map` overrides any column — `--map
"Tags=tags:multi_select"` splits comma-separated cells into a list, `--map
"Notes="` drops a column. Empty cells are omitted, not written as empty
strings. The collection's schema (`.cortex/schemas/<name>.yaml`) is created
from the mapping, or merged into if it exists: a property that is already
declared keeps its type and the cells are coerced to it. A new collection also
gets its `_index.md` with a table view. `--dry-run` prints the mapping and the
first five rows as they would be written; the app's dialog shows the same
plan, with the mapping editable, before its Import button.

```bash
cortex import csv ~/Downloads/books.csv --collection books --dry-run
cortex import csv ~/Downloads/books.csv --collection books --map "Genres=genres:multi_select" --map "Internal id="
```

**A folder of Markdown into notes.** Every `*.md` under the folder — an
Obsidian vault, a Notion export, a directory of files — is copied to
`notes/<into>/` (default: the folder's name), keeping its relative structure.
Frontmatter is copied verbatim (run `cortex fmt notes/<into>` afterwards if
you want the keys sorted) and `[[wiki links]]` are left as they are, so an
Obsidian vault's links keep resolving by title. Images the notes reference —
`![alt](path/pic.png)`, `![[pic.png]]`, `![[pic.png|alt]]` — are copied into
`assets/` (a name already taken by a different file gets a `-2` suffix) and the
references are rewritten to `assets/pic.png`; a reference that points nowhere
is left as written and listed. Dot-folders (`.obsidian/`, `.git/`, `.trash/`)
are skipped without being entered, non-Markdown files are skipped, and every
skip is reported with its reason. The source folder is only ever read.

```bash
cortex import markdown ~/Obsidian/Personal --dry-run      # what would land where
cortex import markdown ~/Obsidian/Personal --into personal
```

**A Notion export, in one go.** Notion's *Export → Markdown & CSV* gives a
zip in which every page is `Title <hash>.md`, every database is
`Title <hash>.csv` (plus a `_all` variant holding the rows a filtered view
hid) beside a `Title <hash>/` folder of row pages, links are relative paths
with `%20` and the hash, and a database page opens with a `Key: value` block
of its properties. `cortex import notion <zip>` (or the folder the zip
unpacks to) turns that into vault files: pages land under `notes/<into>/`
(default `notion`) with the hashes stripped from every path component and
the `# Title` heading moved into `title:`; each database becomes
`collections/<name>/` — one row note per CSV record (the `_all` file wins),
the row page's body under the frontmatter, the schema inferred from the
header and the cells (`Yes`/`No` → checkbox, `January 5, 2024` → date,
numbers, URLs, a `Status` column → status, comma-separated cells → multi-select,
a small repeated vocabulary → select, `Title (../Other%20<hash>/Row.md)` →
a relation to that collection holding the row titles), and `_index.md` with
a table view; a page's property block becomes its frontmatter; links between
exported files become `[[Title]]`; images go to `assets/`. Whatever has no
exact equivalent — a time of day or a date range end that a `date` property
cannot hold, a relation to a database outside the export, two pages that
share a title so `[[Title]]` is ambiguous, links that point outside the
export — is listed in `notes/<into>/Notion import report.md` as well as in
the command's output. The zip is unpacked under the system temp folder and
removed afterwards; the export itself is only read. Importing the same
export twice writes nothing the second time and says so.

```bash
cortex import notion ~/Downloads/Export-3f2a….zip --dry-run    # what would land where
cortex import notion ~/Downloads/Export-3f2a….zip --into notion
```

Over MCP the same operations are `import_csv` (`path`, `collection`,
optional `title_column`, `columns` overrides of `{header, property, type}`,
`dry_run`), `import_markdown` (`path`, optional `into`, `dry_run`) and
`import_notion` (`path`, optional `into`, `dry_run`). In the app:
**Import…** in the command palette.

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

A collection's page (`collections/<name>/_index.md`) may add `parent:` — another
collection's name, or a `notes/<folder>` path — to nest in the sidebar under
it. Only the sidebar reads it; nothing moves on disk. Drag a collection onto a
folder or another collection in the app to set it.

Keys are kept **alphabetically sorted** so every writer produces identical
output and diffs stay clean. `cortex set` / `cortex fmt` / the MCP tools do
this for you; if you write files by hand, sort the keys.
