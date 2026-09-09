# Notion parity — feature-by-feature

Audited 2026-09-09 against `main` at `e728bc8`, by reading the code (not
the README). Line numbers are from that commit and will drift. The
editor is BlockNote 0.51 with four custom blocks (`src/components/Shell/schema.ts`).

Status: **done** (usable, on par or better) · **partial** (exists, with a
real limitation) · **missing** (no code). Effort is the rough cost to
close the gap: S (an evening), M (a session or two), L (a project).

Cortex's constraint, which Notion does not have: every block must
degrade to legible Markdown on disk (`docs/ROADMAP.md`, principle 3).
Several "partial" rows below are where BlockNote can do a thing on
screen but the Markdown save path throws it away.

## 1. Blocks

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Paragraph, headings 1-6, bullet / numbered / check lists, quote, divider | done | — | BlockNote defaults. Check-list items strike through live (`index.css:61`). |
| Toggle list / toggle heading | partial | M | Works on screen, but the Markdown exporter flattens `<details>` to a plain bullet or heading, so the toggle is gone on reopen. The roadmap's chosen serialisation is `<details><summary>`. |
| Callout | partial | S | Five fixed kinds (note, tip, info, warning, danger) with fixed emoji and colour (`CalloutBlock.tsx:21`); the icon click only cycles kinds. Inline content only, no nested blocks. Round-trips as `> [!type]`. |
| Code block: language, highlighting | partial | S | The fence language survives the parse, but the app passes no `supportedLanguages` so there is no picker, and no highlighter is configured (no shiki dependency). Plain monospace. |
| Table | partial | M | Default table block with handles. Saved as GFM, so cell colours, column widths, header column and merged cells are lost. |
| Image: paste, drop, upload | done | — | Custom paste/drop plugin (`Editor.tsx:389-431`), stored in `assets/` (`commands/notes.rs:772`). |
| Image: resize | partial | S | Resize handles work, but width has no Markdown form and resets on reload. |
| Image: caption | partial | S | Serialised as `<figure>`, but the asset rehydration regex only matches `![](assets/…)` (`Editor.tsx:58`), so a captioned image renders broken after reload. |
| File attachment | partial | M | Uploads to `assets/`, degrades to a plain link on save; `read_asset` labels every non-image as `image/png` (`commands/notes.rs:833`) so non-image assets cannot be served. |
| Video / audio | partial | M | Blocks exist; same asset rehydration gap; no YouTube/Vimeo player or oEmbed. |
| Bookmark / link preview | missing | M | No fetch or preview code. Roadmap: plain `[title](url)` with a cached card in `.brain/`. |
| Web embed (iframe) | missing | M | |
| Math / equation (inline and block) | missing | M | No KaTeX dependency, no `$…$` handling anywhere. |
| Columns | missing | L | Needs `@blocknote/xl-multi-column`; the roadmap rates it the weakest Markdown fit. |
| Synced blocks | missing | L | Closest is the read-only `![[note]]` embed. |
| Table of contents block | missing | M | |
| Breadcrumb | missing | S | `parent` exists on `NoteEntry` (`note.rs:25`) but only the sidebar uses it. |
| Button block | missing | M | |
| Emoji picker (`:`) | done | — | BlockNote default, left enabled. |
| Mention: @page | done | — | `@` and `[[` both insert `[[Title]]`, indexed as a link. |
| Mention: @person | partial | M | Inserts plain text `@Name` from `.cortex/members.yaml` (`Editor.tsx:477`); no node, no link, not indexed, no notification. |
| Mention: @date | partial | S | Today / Tomorrow / Yesterday as bare ISO text; no date object, picker or reminder. |
| Note embed / transclusion `![[note]]` | partial | M | See `obsidian-parity.md` §1. Preview-quality renderer, read-only. |
| Database view in a note | done | — | `cortex-view` fence: table, board, calendar, gallery, chart, tracker, timeline over a collection or CSV; rows editable in place (`CortexViewBlock.tsx`). |
| Linked view of a collection | done | — | `cortex-views` fence shows the collection's own view tabs in any note (`CollectionViewsBlock.tsx`). See §5 for the caveat. |

## 2. Inline formatting

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Bold, italic, strikethrough, code, link | done | — | |
| Underline | partial | M | Applies on screen; the exporter strips `<u>` on save. |
| Text colour, highlight | partial | M | Applies on screen; colour spans are stripped on save. Cortex needs a Markdown convention (`==mark==` for highlight is the obvious one; colour may be a non-goal). |
| Inline math | missing | M | |
| `Ctrl+B` | note | S | Bound to toggle-sidebar in capture phase (`keymap.ts:49`), so bold is toolbar or `**` only. |

## 3. Page level and editor chrome

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Title, emoji icon, cover image | done | — | Cover add / change / remove / drop (`Editor.tsx:821`). No reposition, no Unsplash. Filename never follows the title. |
| Image icon | partial | S | Renders if `icon:` is an asset path, but the only UI is the emoji picker. |
| Page width / small text toggles | missing | S | `max-width: 740px` hard-coded (`Editor.module.css:128`). |
| Properties panel | done | — | Typed rows, schema-ordered, option colours, add property with nine types (`PropertiesPanel.tsx`). |
| Slash menu, drag handle, nesting, Markdown shortcuts | done | — | Defaults plus Cortex items: seven view types, collection views, embed, callout. |
| Undo / redo | done | — | ProseMirror history; no buttons or palette entries. |
| Find in note | missing | S | |
| Word count | missing | S | |
| Outline / TOC panel | missing | M | |
| Spell check | partial | S | Webview default; no dictionary or language control. |
| Raw Markdown / source mode | missing | M | The file is plain Markdown but there is no source view. |
| Focus mode | done, beyond Notion | — | Monk mode, `mod+shift+m`. |
| Backlinks under the note | done, beyond Notion | — | |
| Per-note version history + restore | done, beyond Notion | — | Git-backed, with author, diff and restore (`NoteHistoryModal.tsx`). |

## 4. Databases: model and property types

A collection is `collections/<name>/`, one Markdown file per row, frontmatter
as properties, `_index.md` as the database page whose frontmatter holds the
views (`data.rs:150`, `database.ts:38`). The schema is a committed
`.cortex/schemas/<key>.yaml` (`schema.rs:1`). Untyped collections still render
by inferring column types (`data.rs:128`).

| Property type | Status | Effort | Notes |
|---|---|---|---|
| text, number, select, multi-select, status, date, checkbox, url, person | done | — | `schema.rs:26-46`. Select options carry colours. |
| relation | done | — | Stored as a list of row titles (wiki-link semantics), not stable ids: renaming a related row silently breaks the link (`data.rs:1464`). |
| rollup | done | — | count, values, sum, avg, min, max, plus percent on the reverse side; supports a `where` filter, which Notion lacks (`data.rs:1480`). Missing: median, range, unique, empty / not-empty counts, checked / unchecked. |
| formula | done | — | Own evaluator (`formula.rs`): arithmetic, comparison, boolean, `days_until`, `days_since`, `days_between`, `today`, `year`, `month`, `round`, `abs`, `min`, `max`, `if`, `coalesce`, `len`, `contains`, `concat`, `lower`, `upper`, `empty`. Missing: `format`, `dateAdd`, `formatDate`, `week`/`day`/`hour`, regex, `slice`, `join`, `map`/`filter` over relations, property names with spaces, any time-of-day. A bad expression silently yields nothing. |
| Number formats | done | — | percent, progress bar, currency (bare unit prefix, not locale codes), stars, integer, decimal, with min / max / unit (`schema.rs:99`). |
| Auto-stamped dates (`auto: status == done`) | done, beyond Notion | — | `data.rs:1111`. |
| Recurrence (`repeat: 2w`, `repeat_mode: advance`) | done, beyond Notion | — | `recurrence.rs`. Data-model only; nothing fires while the app is closed. |
| date range (start + end in one property) | missing | M | The timeline uses two separate date properties. |
| files / media | missing | M | Gallery covers are a `cover` string convention. |
| email, phone | missing | S | Text with no validation or `mailto:` / `tel:` affordance. |
| created time / by, last edited time / by | partial | M | `created` is a plain date seeded by the client. Last-edited-by comes from git and shows only in the properties panel header (`PropertiesPanel.tsx:194`); none are queryable columns. |
| unique id / auto-number | missing | M | Row id is `row-<base36 timestamp>`, hidden from cells. |
| button property | missing | L | |

## 5. Views

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Table | done | — | |
| Board, group by select / status, drag between columns | done | — | Column order follows the schema's option order (`CortexViewBlock.tsx:942`). |
| Card reorder within a column | missing | M | Cards follow the query sort only. |
| Calendar (month) with per-day add | done | — | |
| Calendar week / day modes; multi-day spans | missing | S / M | Rows sit on one date. |
| Gallery with cover | done | — | Cover is always the `cover` field; no "preview = page content". |
| Timeline / Gantt | done | — | Read-only bars from `start` to `end`; no drag to reschedule (`TimelineView.tsx`). |
| Chart | done, beyond Notion | — | `data.rs:1756`, dependency-free SVG. |
| Tracker (habit grid with streaks) | done, beyond Notion | — | `tracker.rs`; same from CLI and MCP. |
| List view | missing | S | `ViewType` has no `list` (`commands.ts:106`). |
| Multiple saved views, committed as YAML | done | — | `_index.md` frontmatter; add / rename / delete tabs (`DataViews.tsx`). |
| Per-view visible columns and order | done | — | Toggling a column appends it; no drag reorder. |
| Column width, wrap | missing | M | `min-width: 150px` in CSS only. |
| Linked view with its own filter | partial | M | A `cortex-views` block in another note edits the source collection's views everywhere (`CollectionViewsBlock.tsx:9`). A private per-embed filter needs the `cortex-view` block instead. Deliberate, but a Notion divergence. |
| Row peek / side panel | missing | M | Opening a row replaces the editor. |

## 6. Filter, sort, group, search

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Filter operators | partial | M | `== != > >= < <= contains` (`data.rs:282`). Missing: `starts_with`, `ends_with`, `is_empty` (only via `== ''`), `does_not_contain`, date `is_within` / relative ranges. |
| Compound and / or | partial | S | Left-to-right, no precedence, no parentheses (`data.rs:441`): `a or b and c` silently misgroups. |
| Nested filter groups | missing | M | |
| Filter UI | done | — | Clause rows with field / op / value; mixed and/or falls back to read-only raw edit (`ViewToolbar.tsx:120`). |
| Relative dates (`@today+30`, `@monday`, `@month`) and `@me` | done, beyond Notion | — | `data.rs:528`, `:686`. |
| Multi-key sort with UI | done | — | Empty cells last; selects sort by option order. |
| Group by in table view; sub-groups | missing | M / L | `group:` is board-only (`ViewToolbar.tsx:212`). |
| Search box inside a database | missing | S | Global FTS is not collection-scoped. |
| Summary row (count, sum, …) | missing | M | Footer shows a row count only. |

## 7. Rows and editing

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Add row inline (table, board column, calendar day, gallery) | done | — | New rows are seeded from the view's filter so they stay visible (`CortexViewBlock.tsx:448`). |
| Row templates, default per collection, variables | done | — | `_template-<slug>.md`; `{{date}} {{time}} {{title}} {{uuid}}` (`data.rs:1350`). |
| Save row as template | partial | S | Backend, Tauri command and TS binding exist; nothing in the UI calls it (`commands.ts:567`). |
| Duplicate row | missing | S | `duplicate_note` exists for the file tree only. |
| Open row as page, delete row (to trash) | done | — | |
| Inline cell editing: text, number, checkbox, select / multi / status / person / relation, stars | done | — | |
| Date picker | missing | S | Date cells and the properties panel are bare text inputs; `2026-13-45` is accepted. |
| Keyboard navigation in the table | missing | M | Only Enter / Escape inside an open cell. The timeline has `j/k/Enter`; the table does not. |
| Multi-row select, bulk edit | missing | M | Delete is one row at a time with `window.confirm`. |
| Column resize, drag reorder | missing | M | |
| Add property from the header (incl. relation / rollup / formula config) | done | — | `AddPropertyHeader` (`CortexViewBlock.tsx:171`). |
| Change property type | partial | S | Nine basic types only; cannot retype into relation / rollup / formula. |
| Rename property | missing | M | No command, no UI. Must also rewrite every row's frontmatter key. |
| Delete property | missing | M | Only whole-schema `set_schema` exists and nothing calls it. |
| Convert checklist note ⇄ database | done, beyond Notion | — | `Shell.tsx:419`. |

## 8. Import and export

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Notion export (zip of Markdown + CSV) | missing | L | No importer of any kind. The single biggest adoption blocker. |
| CSV import into a collection | missing | M | CSV is readable as a view *source* under `data/` (`data.rs:248`), never converted to rows. |
| Markdown folder / Obsidian vault | partial | S | `open_vault` opens any directory, `git init`s it, writes `VAULT.md` / `AGENTS.md` and indexes every `.md`. "Import" is "point it at the folder", with side-effect files. |
| Evernote, HTML import | missing | M | |
| Export: Markdown | native | — | The files are already Markdown. |
| Export: note → HTML, collection → CSV / HTML | done | — | `export.ts`, `data.rs:1627-1655`. |
| Export: PDF | missing | M | No print stylesheet or `window.print()`. |
| Export: whole vault bundle | missing | S | |

## 9. Comments and collaboration

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Comments, threads, resolve | missing | L | Zero code. Roadmap: a committed `notes/foo.comments.yaml` sidecar with text-quote anchors. BlockNote has a comments extension that needs a thread store. |
| @person mention with notification | partial | M | Plain text (§1). |
| Notifications / inbox | missing | L | No notification plugin. |
| Activity / updates feed | partial | M | The sidebar's recent-commits list; not per page, not "since you last looked". |
| Real-time co-editing, cursors, presence | done | — | Yjs over a self-hosted `y-websocket` relay set by `collab_url` (`collab.ts`). No bundled server, no relay auth, no offline CRDT persistence. If peers already hold a doc it wins over the file on open (`Editor.tsx:542`), so a stale relay can shadow a newer file. |
| Page history with author, restore, commit diff viewer | done | — | |

## 10. Sharing and publishing

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Publish to web (static site) | done | — | One page per note, index, assets, `search.json`, write manifest for safe rebuilds (`publish.rs:146`). |
| Per-note public flag | done | — | `publish: true` or the `public` tag; palette toggle; never `templates/`, `VAULT.md`, `AGENTS.md`. |
| Wiki links, aliases, anchors; unpublished targets degrade to text | done | — | |
| Callouts on the site | done | — | Eight kinds. |
| Database views on the site | missing | M | A `cortex-view` fence publishes as a raw YAML code block. |
| Site search | partial | S | Four-line `indexOf` over title and tags; body text never searchable; `search.json` unused. |
| GitHub Pages push + Action | done | — | `workflow_dispatch` only, by design. |
| Custom domain (`CNAME`) | missing | S | |
| Share link with permissions, guests, page-level permissions, teamspaces | missing | L | No permission model. `members.yaml` is a roster for `person` options and `@me`; it grants nothing (`members.rs`). |
| Hosted service | missing, backlogged | L | `docs/ROADMAP.md`, Publishing. |

## 11. Templates

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Note templates, new-from-template, row templates | done | — | |
| Variables | partial | S | New-from-template gets `date`, `time`, `title`, `uuid`; the richer `placeholders.rs` vocabulary (`today+7`, `monday-1`, `week`) only runs for packs and row templates. No prompts. |
| Template gallery (marketplace) | done, beyond Notion | — | Fifteen packs; install / update / remove with per-file hashes so user edits are never clobbered (`marketplace.rs`); trust tiers; private registries; `packs lint` / `new` / `index` for authors. |
| A fresh vault ships zero collections | note | S | `vault-template/` has only `notes/` and `templates/`; the first database always comes from a pack. |

## 12. Search

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Full-text index | done | — | FTS5 over title and body (`db.rs:42`); tags, type, parent, icon are in `notes` but not in FTS. `icon` / `parent` are computed by the indexer but never persisted (`db.rs:63`). |
| Query syntax | partial | S | Non-alphanumerics stripped, `*` appended per word (`db.rs:209`): no phrases, `OR`, `NOT`, or field scoping. |
| Snippets / highlights | missing | S | |
| Ranking | partial | S | Raw BM25; no title boost or recency. |
| Search filters (tag, type, date, folder) | missing | M | |
| Quick switcher | partial | S | Client-side substring over the loaded note list; does not use FTS, so cannot match body text. |
| CLI `cortex search` | done | — | Note: every CLI invocation re-indexes the whole vault (`ops.rs:148`). |

## 13. API and automation

| Feature | Status | Effort | Notes |
|---|---|---|---|
| CLI | done, beyond Notion | — | 25 subcommands, `--json` everywhere. Full list in `docs/agent-integration.md`. |
| MCP server | done, beyond Notion | — | 26 tools over stdio (`mcp.rs:208-345`). `move_note` renames / moves with link rewriting. Absent from MCP but present in the app: delete, trash, publish build, git sync / commit, proposal apply / discard, members, favorites. |
| Proposals (branch, list, diff, apply, discard) in app and CLI | done, beyond Notion | — | `git.rs:523-628`. |
| Filesystem watcher | done | — | |
| HTTP API / webhooks | missing | L | No server crate. |
| Automations (when X then Y) | missing | L | Only the hard-coded engine rules (auto-dates, recurrence). |
| Buttons | missing | M | |
| Reminders / due-date notifications | missing | L | |
| Overnight agent runner | note | — | The backlog `_index.md` names `tools/overnight/run_overnight.py`; the repo's `tools/` holds only `sync-packs.sh`, so the runner lives outside this repo. |

## 14. AI

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Built-in writing assistant, Q&A over the vault, autofill properties | missing, by design | L | No model SDK, no API-key setting, no embeddings. |
| AI via external agents | done | — | CLI, MCP, embedded terminal that opens into a detected agent CLI (`agents.rs:40`), and proposals for review. This is the product's position: bring your own agent, get a typed interface plus a PR-style review loop. |

## 15. Platforms, release, mobile

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Desktop builds | partial | S | `targets: "all"` with no per-OS bundle or signing config (`tauri.conf.json:29`). Tiling-WM decorations handled. |
| CI / release workflow | missing | M | No `.github/` in the repo. |
| Auto-update | missing | M | No `tauri-plugin-updater`. |
| Mobile (Android / iOS) | missing | L | No mobile targets, no `gen/`, git shells out. See `obsidian-parity.md` §14 and the two mobile backlog rows. |
| Responsive layout | missing | M | Three `@media` rules, all in overlays; sidebar fixed at 260px; window `minWidth: 800`. |
| Onboarding | done | — | Getting-started card, `VAULT.md` / `AGENTS.md`, searchable settings hints. No `?` shortcut overlay, no in-app help. |

## Where Cortex is ahead of Notion

- Plain Markdown and git as the database: history, diffs, branches, any host, offline.
- Agents as a first-class client: CLI, MCP, proposals reviewed as diffs, embedded terminal.
- Rollup `where` filters, relative-date filter literals, auto-stamped dates, recurrence, chart and tracker views, journal-as-collection.
- Template packs with hash-tracked provenance; private registries.
- Live desktop-palette theming; a real keymap registry with a recorder.

## Notable gaps, ranked

1. **No import path.** Nobody can move in from Notion, CSV, or Evernote. Opening a Markdown folder works but writes files into it.
2. **Silent formatting loss on save**: underline, colour, highlight, toggles, image width. They look like they work until the note is reopened.
3. **No math, columns, bookmarks, embeds, TOC, synced blocks, buttons.** Math is the cheapest and the most missed.
4. **Property rename and delete do not exist.** A mistyped property name is permanent from the app.
5. **Table editing is mouse-only**: no keyboard cell navigation, bulk edit, column resize / reorder, or date picker.
6. **Filter grammar has no precedence** and no `is_empty` / `starts_with`; table view cannot group; no in-database search or summary row.
7. **No comments, mentions are plain text, no notifications.** Co-editing exists; discussion does not.
8. **No permissions or sharing model**; publishing is all-or-nothing per note.
9. **Search discards FTS5's power**: no phrases, operators, snippets or filters; the quick switcher ignores FTS.
10. **Rows are re-parsed from disk on every render**, with rollups re-reading the target collection once per rollup property (`data.rs:1525`). Fine at personal scale, a cliff past a few thousand rows.
11. **No CI, no release pipeline, no auto-update.** There is currently no way for a user to receive a build.
12. **Mobile is a doc, not a target.**
