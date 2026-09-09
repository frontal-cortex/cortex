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
| Toggle list / toggle heading | done | — | Saved as `<details><summary>…</summary> … </details>` (a heading inside the summary for toggle headings), the roadmap's chosen form; inline styles in the summary go out as HTML tags. Translated at the load/save boundary (`richFormats.ts`). |
| Callout | partial | S | Five fixed kinds (note, tip, info, warning, danger) with fixed emoji and colour (`CalloutBlock.tsx:21`); the icon click only cycles kinds. Inline content only, no nested blocks. Round-trips as `> [!type]`. |
| Code block: language, highlighting | done | — | Picker over a curated list of 33 languages and lazily loaded shiki highlighting (`Shell/codeBlock.ts`). Colours are `--code-*` tokens (`tokens.css`), so they follow light/dark and the desktop palette. Still an ordinary ```lang fence on disk; a fence language outside the list is kept as-is. |
| Table | partial | M | Default table block with handles. Saved as GFM, so cell colours, column widths, header column and merged cells are lost. |
| Image: paste, drop, upload | done | — | Custom paste/drop plugin (`Editor.tsx:389-431`), stored in `assets/` (`commands/notes.rs:772`). |
| Image: resize | done | — | A resized image is saved as `<img src="assets/…" alt="…" width="480">` (inside `<figure>` when captioned); an unsized one stays `![alt](assets/…)`. GitHub and Obsidian honour the width. |
| Image: caption | done | — | Serialised as `<figure>`; asset rehydration now matches `<img src="assets/…">` as well as `![](assets/…)`. |
| File attachment | partial | M | Uploads to `assets/`, degrades to a plain link on save; `read_asset` labels every non-image as `image/png` (`commands/notes.rs:833`) so non-image assets cannot be served. |
| Video / audio | partial | M | Blocks exist; same asset rehydration gap; no YouTube/Vimeo player or oEmbed. |
| Bookmark / link preview | missing | M | No fetch or preview code. Roadmap: plain `[title](url)` with a cached card in `.brain/`. |
| Web embed (iframe) | missing | M | |
| Math / equation (inline and block) | done | — | `$…$` and `$$…$$` on disk (GitHub/Obsidian syntax), KaTeX bundled locally (`MathBlock.tsx`, `src/lib/math.ts`). `/math` and `$$` on an empty line open a block; typing `$…$` makes an inline equation. The static site shows the LaTeX source in a `.math` span (no KaTeX shipped there). |
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
| Underline | done | — | Saved as `<u>…</u>`; runs of underlined text keep bold / italic inside them (`<u>**a** b</u>`). |
| Highlight | partial | S | Saved as `==text==` (Obsidian's syntax; rendered as `<mark>` by `cortex publish`). The highlight *colour* is not stored — every highlight reopens as the default yellow. |
| Text colour | non-goal | — | Applies on screen only; the span is dropped on save. There is no legible Markdown form for a coloured run and inline `<span style>` would fail principle 3, so this stays a deliberate non-goal (see below). |
| Inline math | done | — | `$E = mc^2$` typed in a paragraph becomes a KaTeX node; click to edit the source. Stored as plain `$…$`. |
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
| Find in note | done | — | `mod+f` (`find-in-note`); ProseMirror decorations, match count, Enter / Shift+Enter, Esc lands on the match (`lib/findInNote.ts`, `FindBar.tsx`). |
| Word count | done | — | Words, characters and reading time in a status line under the page; hidden in monk mode; nothing stored (`lib/textStats.ts`). |
| Outline / TOC panel | done | — | Headings derived live from the blocks, pane beside the page (`mod+shift+o`), click jumps, follows the cursor (`OutlinePane.tsx`). |
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
| rollup | done | — | count, values, sum, avg, min, max, empty, not_empty, percent_checked, plus percent on the reverse side; supports a `where` filter, which Notion lacks (`data.rs:1480`). Missing: median, range, unique. |
| formula | done | — | Own evaluator (`formula.rs`): arithmetic, comparison, boolean, `days_until`, `days_since`, `days_between`, `today`, `year`, `month`, `round`, `abs`, `min`, `max`, `if`, `coalesce`, `len`, `contains`, `concat`, `lower`, `upper`, `empty`. Missing: `format`, `dateAdd`, `formatDate`, `week`/`day`/`hour`, regex, `slice`, `join`, `map`/`filter` over relations, property names with spaces, any time-of-day. A bad expression silently yields nothing. |
| Number formats | done | — | percent, progress bar, currency (bare unit prefix, not locale codes), stars, integer, decimal, with min / max / unit (`schema.rs:99`). |
| Auto-stamped dates (`auto: status == done`) | done, beyond Notion | — | `data.rs:1111`. |
| Recurrence (`repeat: 2w`, `repeat_mode: advance`) | done, beyond Notion | — | `recurrence.rs`. Data-model only; nothing fires while the app is closed. |
| date range (start + end in one property) | done | — | `type: date_range`, stored as `key: {start, end}` under one frontmatter key (`schema.rs`, `data.rs` `CellValue::Range`): `<`/`<=` compare the end, `>`/`>=` the start, `==` and `within` mean overlap, sort is by start; a repeat moves the whole range. Two date pickers in the table and panel; `start: trip` on a timeline draws both ends, a calendar shows the row on every day it spans. |
| files / media | done | — | `type: files`: a list of `assets/…` paths; thumbnails for images, name chips otherwise, an upload button through `save_asset` (`PropertyInputs.tsx`). Gallery covers still read the `cover` string. |
| email, phone | missing | S | Text with no validation or `mailto:` / `tel:` affordance. |
| created time / by, last edited time / by | done | — | `created_time` / `created_by` / `edited_time` / `edited_by` property types, computed from git history in one walk per view run (`git.rs` `authorship`, `data.rs` `apply_authorship`) with the file's mtime standing in outside a repo; never written to a row. Read-only in the table and panel, usable in filter and sort (they run before filters, like rollups); a day literal compares against the `YYYY-MM-DDTHH:MM` value by day. |
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
| Filter operators | done | — | `== != > >= < <= contains does_not_contain starts_with ends_with is_empty is_not_empty in [a, b] within 7d` (`data.rs` `Op`). `within` takes `d w m y` and a sign for the past. |
| Compound and / or | done | — | Precedence climber: `and` binds tighter than `or`, parentheses group, `not` prefix (`parse_filter`). |
| Nested filter groups | done | — | Arbitrary depth in the grammar; the toolbar edits one level of parentheses and defers deeper nesting or `not` to raw edit. |
| Filter UI | done | — | Clause rows with field / op / value, one parenthesised group per clause slot; nested groups, `not` and unparenthesised mixed and/or fall back to raw edit (`ViewToolbar.tsx`). |
| Relative dates (`@today+30`, `@monday`, `@month`) and `@me` | done, beyond Notion | — | `data.rs:528`, `:686`. |
| Multi-key sort with UI | done | — | Empty cells last; selects sort by option order. |
| Group by in table view; sub-groups | partial | L | `group:` folds a table into one collapsible section per value in option order, empty last, with a count and an in-group add row that seeds the value (`CortexViewBlock.tsx` `DataTable`). Sub-groups missing. |
| Search box inside a database | missing | S | Global FTS is not collection-scoped. |
| Summary row (count, sum, …) | done | — | `summary: {amount: sum, done: percent_checked}` in the view spec; count, sum, avg, min, max, percent_checked, empty, not_empty computed by the engine over the visible rows (`data.rs` `summarize`), so `cortex view --summary` and MCP return the same numbers. Picked per column from the footer; nothing is written to a row. Missing: median, range, unique, per-group summaries. |

## 7. Rows and editing

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Add row inline (table, board column, calendar day, gallery) | done | — | New rows are seeded from the view's filter so they stay visible (`CortexViewBlock.tsx:448`). |
| Row templates, default per collection, variables | done | — | `_template-<slug>.md`; `{{date}} {{time}} {{title}} {{uuid}}` (`data.rs:1350`). |
| Save row as template | done | — | Row menu (⋯) → "Save as template…"; the New row dropdown picks it up at once. |
| Duplicate row | done | — | `data::duplicate_row` (frontmatter + body, new id, `created` today, title marked "copy"); Tauri `duplicate_row`; row menu (⋯) → Duplicate, focus lands on the copy. |
| Open row as page, delete row (to trash) | done | — | |
| Inline cell editing: text, number, checkbox, select / multi / status / person / relation, stars | done | — | |
| Date picker | done | — | `DatePicker.tsx`: typed input validated to a real calendar day (`2026-13-45` refused), calendar popover with keyboard grid; used by date cells, the properties panel and the calendar view's New row. |
| Keyboard navigation in the table | done | — | Roving cell focus: arrows / `j k h l`, Tab / Shift+Tab, Home / End, Enter edits, Escape cancels, Ctrl+Enter or `o` opens the row, `n` new row, Delete trashes (`TABLE_KEYS` in `keymap.ts`). |
| Multi-row select, bulk edit | missing | M | Delete is one row at a time with `window.confirm`. |
| Column resize, drag reorder | missing | M | |
| Add property from the header (incl. relation / rollup / formula config) | done | — | `AddPropertyHeader` (`CortexViewBlock.tsx:171`). |
| Change property type | partial | S | Nine basic types only; cannot retype into relation / rollup / formula. |
| Rename property | done | — | `schema::rename_property`: the schema, every row's frontmatter key (one line per file), the collection's views (columns, sort, filter, group, date/chart fields) and the rollups / formulas / auto-dates in any schema that name it. Column header menu, properties panel, `cortex schema rename`, MCP `rename_property`. Views embedded as `cortex-view` fences in other notes are not rewritten. |
| Delete property | done | — | `schema::delete_property`: schema, every row, every view (a mixed and/or filter is left for the user). Refused while a rollup, formula or auto-date in any schema depends on it — the error names them. Column header menu, properties panel, `cortex schema rm`, MCP `delete_property`. |
| Convert checklist note ⇄ database | done, beyond Notion | — | `Shell.tsx:419`. |

## 8. Import and export

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Notion export (zip of Markdown + CSV) | done | — | `cortex import notion <zip-or-dir> [--into NAME] [--dry-run]`, MCP `import_notion`, the **Notion export** tab of **Import…** (`import/notion.rs`, pure-Rust `zip`): hashes stripped from every path, each CSV + row folder a collection with the schema inferred from the cells (select, multi-select, date, checkbox, url, number, status, relation by title), the page property block as frontmatter, intra-export links → `[[Title]]`, images → `assets/`, and a `Notion import report` note listing what could not be mapped (times and range ends dropped from dates, relations to databases outside the export, ambiguous titles, dangling links). Idempotent: a re-run writes nothing. Not carried: Notion's page icons / covers, per-block formatting that Markdown lacks, and attachments other than images (skipped and listed). |
| CSV import into a collection | done | — | `import.rs`: `cortex import csv`, MCP `import_csv`, **Import…** in the palette. One row note per record named from the title column, types inferred (number, date, checkbox, url, select from a small vocabulary; `--map` overrides), schema written or merged, `_index.md` for a new collection, dry-run preview of the first five rows. |
| Markdown folder / Obsidian vault | done | — | `cortex import markdown <dir> [--into NAME]`, MCP `import_markdown`, **Import…** in the palette: copies `*.md` under `notes/<name>/`, frontmatter and `[[links]]` untouched, referenced images into `assets/` with paths rewritten, dot-folders skipped and every skip reported; the source is never modified. `open_vault` still works for "use this folder as the vault". |
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
| Query syntax | done | — | `search.rs`: `"phrases"`, `-word`, `OR`, `tag:` / `type:` / `path:` filters (negatable); every term quoted so punctuation never breaks the FTS5 query. |
| Snippets / highlights | done | — | `snippet()` on the body with `<mark>` around the match; under each sidebar result, in the quick switcher, in `cortex search` and the MCP `search` tool. |
| Ranking | partial | S | BM25 with the title weighted 5× over the body; no recency. |
| Search filters (tag, type, date, folder) | partial | S | `tag:`, `type:`, `path:` (folder as a path substring). No date filter. |
| Quick switcher | partial | S | Substring over the loaded note list first; falls back to FTS when that finds nothing, so body text reaches the note. |
| CLI `cortex search` | done | — | Note: every CLI invocation re-indexes the whole vault (`ops.rs:148`). |

## 13. API and automation

| Feature | Status | Effort | Notes |
|---|---|---|---|
| CLI | done, beyond Notion | — | 25 subcommands, `--json` everywhere. Full list in `docs/agent-integration.md`. |
| MCP server | done, beyond Notion | — | 28 tools over stdio (`mcp.rs`). `move_note` renames / moves with link rewriting. Absent from MCP but present in the app: delete, trash, publish build, git sync / commit, proposal apply / discard, members, favorites. |
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

1. **Evernote / HTML have no import path.** Notion exports, CSV and Markdown folders all import (§8).
2. **Text colour is dropped on save** (a deliberate non-goal, below); the highlight colour collapses to yellow. Underline, highlight, toggles and image width now survive.
3. **No columns, bookmarks, embeds, TOC, synced blocks, buttons.** (Math landed: `$…$` / `$$…$$` with KaTeX.)
4. ~~**Property rename and delete do not exist.**~~ Done: `rename_property` / `delete_property` rewrite the schema, every row and the views, and refuse a delete that a rollup still depends on.
5. **Table editing stops at one row**: no bulk edit, column resize / reorder. (Keyboard cell navigation, a date picker and duplicate row landed.)
6. **No sub-groups in the table view**, and no in-database search. (Filter grammar precedence and operators, table group-by and the summary row have landed.)
7. **No comments, mentions are plain text, no notifications.** Co-editing exists; discussion does not.
8. **No permissions or sharing model**; publishing is all-or-nothing per note.
9. ~~**Search discards FTS5's power**~~ Done: phrases, operators, snippets, tag/type/path filters, FTS fallback in the quick switcher. Still missing: date filters, recency ranking, collection-scoped search.
10. **Rows are re-parsed from disk on every render**, with rollups re-reading the target collection once per rollup property (`data.rs:1525`). Fine at personal scale, a cliff past a few thousand rows.
11. **No CI, no release pipeline, no auto-update.** There is currently no way for a user to receive a build.
12. **Mobile is a doc, not a target.**

## Deliberate non-goals

- **Text colour.** No Markdown convention exists for a coloured run, and `<span style="color:…">` in a note would fail the degradability principle. The editor still shows the colour while the note is open; it is not saved. Highlight is the supported way to mark text.
