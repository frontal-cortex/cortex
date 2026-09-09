# Obsidian parity — feature-by-feature

Audited 2026-09-09 against `main` at `e728bc8`, by reading the code (not
the README). Line numbers are from that commit and will drift.

Status: **done** (usable, on par or better) · **partial** (exists, with a
real limitation) · **missing** (no code). Effort is the rough cost to
close the gap: S (an evening), M (a session or two), L (a project).

Cortex is not trying to be Obsidian. The deliberate non-goals are listed
at the end so they are not mistaken for gaps.

## 1. Links

| Feature | Status | Effort | Notes |
|---|---|---|---|
| `[[wiki links]]` stored as plain text | done | — | A ProseMirror decoration over the literal text (`src/lib/wikiLinkExtension.ts:37`); the file never holds a node type. |
| Autocomplete on `[[` and `@` | done | — | `src/lib/wikiLinkSuggestion.ts:33`, inserted at `Editor.tsx:472`. |
| Aliases `[[note\|alias]]` | done | — | One parser, `note::parse_wiki_link`, feeds the indexer, `vault::resolve`, `resolve_ref`, publish, the CLI and the editor. The decoration shows only the alias (syntax reappears while the cursor is in the link); backlinks and the graph match on the target alone. |
| Heading links `[[note#heading]]` | done | — | Same parser; a click opens the note and scrolls to the heading. Embeds still slice the section. |
| Block references `^id` | missing | L | No block-id parsing or generation anywhere. |
| Link resolution rules | done | — | One resolver, core `vault::resolve` (path, title, exact stem — all case-insensitive), called by `resolve_ref`, the app's click handler (`resolve_note`), the CLI, MCP and the publisher. Duplicate titles still resolve to whichever file the walk yields first; no "create note" on an unresolved click. |
| Automatic link update on rename / move | done | — | `rename::rename_note` in core: sidebar rename / move, editor title edits, `cortex mv`, `cortex set title=` and the MCP `move_note` tool all rewrite inbound `[[old]]`, `[[old\|alias]]`, `[[old#h]]`, `![[old]]` via the `links` table; one commit per rename with `auto_commit`. Ambiguous (shared) titles are left alone. |
| Unlinked mentions | missing | M | No code. |
| Backlinks panel | partial | S | Flat list of titles under the note (`BacklinksPanel.tsx`); `get_backlinks` (`db.rs:98`) returns no context snippet. Hidden when empty. |
| Outgoing links panel | missing | S | Data exists (`db.rs:157`, `cortex links`); no UI. |
| Embeds `![[note]]` / `![[note#section]]` | partial | M | Round-trips as a literal `![[target]]` paragraph (`NoteEmbedBlock.tsx:215`). Rendered by a hand-rolled mini-markdown (`:24-102`): headings, bullets, quotes, bold, code, links only. No tables, images, checkboxes, numbered lists, nested embeds; read-only. `resolve_ref` walks the whole vault per embed on every mount (`commands/notes.rs:94`). |

## 2. Graph

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Global graph | done | — | d3-force modal over the `links` table (`GraphView.tsx:34`, `db.rs:157`). |
| Local graph (neighbours of the open note) | missing | M | No depth or centre filtering. |
| Filters (search, tag, folder, orphans) | missing | M | Toolbar is title, count, close. |
| Tag / folder colouring, node sizing | missing | S | Every node is the same circle; only the `icon` emoji varies. |
| Live physics, node dragging | partial | S | 300 pre-run ticks then `.stop()` (`GraphView.tsx:74`); pan and zoom only. |
| Click to open | done | — | |

## 3. Canvas

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Infinite whiteboard, `.canvas` files | missing | L | Whole feature area absent. JSON Canvas is an open spec, so a read-only viewer is a plausible M first step. |

## 4. Daily notes and journal

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Today note, open-or-create, template | done | — | `useNotes.ts:104`; `journal_template` setting; `mod+shift+t`. Per-user journal folders in a team vault. |
| Journal as a collection (a row per day) | done, beyond Obsidian | — | `journal_template: collections/journal` makes Today that day's row. |
| Quick capture into today | done | — | `Shell.tsx:351`, timestamped bullet. Not a global OS hotkey (needs `tauri-plugin-global-shortcut`). |
| Calendar navigation for journals | missing | M | The only calendar is a collection view over a date property. |
| Previous / next day | missing | S | No command; `@` date mentions insert text only. |
| Periodic notes (weekly / monthly) | missing | M | The date vocabulary exists (`placeholders.rs:20-32`: `monday`, `week`, `month±n`) but no "This week" command uses it. |

## 5. Templates

| Feature | Status | Effort | Notes |
|---|---|---|---|
| `templates/` folder, sidebar section | done | — | |
| Variables | partial | S | New-from-template substitutes exactly `date`, `time`, `title`, `uuid` (`useNotes.ts:87`, `commands/notes.rs:225`). The richer `placeholders.rs` set (`today+7`, `monday-1`, `week`) only runs for pack install and collection row templates (`data.rs:1218`). No cursor placeholder, no prompts, no Templater-style logic. |
| New-from-template UX | done | — | Command palette lists every template; `cortex new --template`. |
| Template packs / marketplace | done, beyond Obsidian | — | `marketplace.rs`: manifest, hashes in `.cortex/packs.yaml`, install/update/remove that never clobber user edits, lint, trust tiers. |

## 6. Tags

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Frontmatter `tags:` | done | — | Indexed as JSON in `notes.tags`; merged with inline tags by `tags::note_tags` (`tags.rs`). |
| Inline `#tags` in the body | done | — | `tags::extract_inline_tags` scans the body next to `extract_wiki_links`; skips code fences, inline code, headings, URLs, `[[Note#Section]]`, `&#39;`, `\#escaped`. Stored in the same `notes.tags` column; nothing written to the file. |
| Nested tags `parent/child` | done | — | `tags::list_tags` builds a tree by `/` with counts (a parent counts its children once per note); `--tag project` matches `project/alpha` (`tags::has_tag`, case-insensitive). |
| Tag browser / tag pane | done | — | Tags sidebar section (`LeftPanel.tsx` `TagTree`, `FileTree.tsx` `BranchRow`): tree by `/`, counts, folds like folders, keyboard-navigable through the flat row model (`treeRows.ts` kind `tag`). Hidden when the vault has no tags. |
| Tag page (all notes with tag X) | done | — | `TagView.tsx`: Enter or a click on a tag opens a filtered view of matching notes (children included), with breadcrumbs, child-tag chips and `j`/`k`/Enter/`h`. A view over the index, never a saved file. |
| Tag autocomplete while writing | done | — | `#` in the editor completes from `list_tags` (`wikiLinkSuggestion.ts` trigger `tag`); a query no tag matches is offered as a new one. Typed `multi_select` properties still complete from the schema. |

## 7. Folders and files

| Feature | Status | Effort | Notes |
|---|---|---|---|
| File tree, nesting, keyboard nav | done | — | Flat row model with roving tabindex, `j/k`, `Enter`, `n`, `/` (`treeRows.ts`). |
| Drag-and-drop move, rename, context menu | done | — | Rename, Duplicate, Turn into collection, Favorite, Reveal, Export HTML, Copy path, Delete (`FileTree.tsx:485`). Rename and drop rewrite inbound links (§1). |
| Folder notes | missing | M | No `folder/folder.md` convention for plain folders (collections have `_index.md`, which is the database page). |
| Explorer sort options | missing | S | Hard-coded A→Z (`fileTree.ts:152`). |
| Favourites | done | — | `.cortex/favorites.yaml`; no nested bookmark folders or bookmarked searches. |
| Recent files | missing | S | `recent.rs` is recent *vaults*, not notes. |

## 8. Search and palettes

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Full-text search (FTS5) | done | — | `notes_fts(title, body)`, ranked (`db.rs:40`, `:174`). |
| Operators (`tag:`, `path:`, quotes, `-`, `OR`, regex) | partial | S | `search::parse` (`search.rs`) translates `"phrases"`, `-word`, `OR`, `tag:` / `type:` / `path:` (negatable) into an FTS5 MATCH plus filters on the `notes` columns; shared by app, CLI and MCP. Title matches are boosted 5×. No regex, `NEAR`, or `line:` / `section:`. |
| Result snippets / highlights | done | — | `snippet()` on the body, `<mark>` around the match, one line; shown under each sidebar result and in the quick switcher's FTS fallback. |
| Vault-wide search and replace | missing | L | |
| Find in note (`Ctrl+F`) | done | — | `find-in-note` (`mod+f`) in `keymap.ts`; decoration-based highlights with count and next / previous (`lib/findInNote.ts`, `FindBar.tsx`). |
| Quick switcher | partial | S | Case-insensitive substring over title/path/tags, then falls back to FTS (with snippets) when that finds nothing, so a body word reaches the note. No fuzzy matching or ranking of the substring pass. |
| Command palette (`>` prefix) | done | — | ~18 actions plus one per template; `mod+shift+p`. |

## 9. Workspace

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Multiple panes / splits | missing | L | `useLayout.ts` is three booleans (left, right, monk); one editor, one `selectedPath`. |
| Tabs, pinned tabs | missing | L | Deliberately removed after a history-corruption bug (`useNavHistory.ts:52`). |
| Back / forward | done | — | 50-deep history, `mod+[` / `mod+]`. |
| Resizable sidebar | missing | S | `--left-panel-width: 260px` is a constant (`tokens.css:60`); `LeftPanel.module.css` fixes both `width` and `min-width`. |
| Outline pane | done | — | Headings derived from the live blocks, beside the page (`toggle-outline`, `mod+shift+o`); click jumps, the entry under the cursor is marked (`OutlinePane.tsx`). |
| Properties pane | done | — | Typed, schema-driven, with option colours; richer than Obsidian's. |
| Status bar (word / char / backlink count) | partial | S | Words, characters and reading time under the page (`lib/textStats.ts`), hidden in monk mode; no backlink count (backlinks list under the note). |
| Focus / zen mode | done | — | "Monk mode", `mod+shift+m`. |
| Right sidebar | partial | S | Exists but is the terminal only (fixed 440px); backlinks and properties live inside the editor column. |

## 10. Hotkeys

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Central shortcut registry, platform labels | done | — | `keymap.ts`, 19 shortcuts, every hint renders from it. |
| Customisable keybindings + recorder | done | — | `keybindings:` in settings; conflict detection; recorder in Settings; settable from the CLI. |
| Keyboard-first navigation | done | — | Sidebar roving tabindex, focus-sidebar / focus-editor; the data table is a roving grid with the same vim keys (`TABLE_KEYS` in `keymap.ts`). |
| Vim keybindings in the editor | missing | L | BlockNote/ProseMirror, not CodeMirror. Non-goal unless a modal-editing plugin appears. |
| `Ctrl+B` | note | S | Bound to toggle-sidebar (capture phase), not bold. A muscle-memory collision for Notion and Obsidian users alike. |

## 11. Appearance

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Light / dark / system | done | — | |
| Desktop palette (Omarchy `colors.toml`), followed live | done, beyond Obsidian | — | `src-tauri/src/theme.rs`. |
| Accent colour, prose font and slant | done | — | 10 curated faces plus any installed family. |
| Readable line width toggle | partial | S | Hard-coded `max-width: 740px` (`Editor.module.css:128`). |
| Custom CSS snippets | missing | M | No snippets folder or style injection. |
| Community themes | missing | L | Built-in tokens plus the palette file only. |

## 12. Plugins and extensibility

| Feature | Status | Effort | Notes |
|---|---|---|---|
| JS plugin API / community plugins | missing, by design | L | `marketplace.rs:6`: "A pack is data, never code." |
| Template and database packs | done | — | See §5. |
| `cortex` CLI | done | — | `ls show new set write mv links backlinks search collections view schema status settings agents propose publish packs tracker track`, all with `--json`. |
| MCP server | done | — | 26 tools (`mcp.rs:208-345`). |
| Declarative `cortex-view` specs in a note | done, beyond Obsidian | — | Same spec runs in the app, CLI and MCP. |
| Agent proposals (branch, diff, apply / discard) | done, beyond Obsidian | — | `git.rs:523`; `CommitDiffModal.tsx`. |
| Custom slash commands | missing | M | Slash menu is a fixed list (`Editor.tsx:737`). |

## 13. Sync and versions

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Git pull / push, ahead-behind counts | done | — | |
| Conflict UI (ours / theirs / edit, abort) | done | — | `ConflictModal.tsx`, `git.rs:348-446`. |
| Auto-commit, timed auto-sync | done | — | |
| Per-note history + restore with diff | done | — | `NoteHistoryModal.tsx`. |
| Trash with retention | done | — | `.trash/` is committed, so it syncs. |
| Live co-editing + presence | done, beyond Obsidian | — | Yjs over a self-hosted relay (`collab.ts`); degrades to plain git. |
| Filesystem watcher for external edits | done | — | Debounced, self-write echo suppression (`watcher.rs`). |
| Hosted device sync (Obsidian Sync) | missing, by design | L | Git is the sync layer. The mobile transport is the real gap (§14). |

## 14. Mobile

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Tauri mobile targets configured | missing | L | `tauri.conf.json` has no `android` / `ios` keys; no `src-tauri/gen/`; no mobile deps. The only mobile artefact is the boilerplate `mobile_entry_point` attribute (`src-tauri/src/lib.rs:24`). |
| Mobile-capable git backend | missing | L | pull, push, merge abort, ours/theirs, complete merge and `git config` all shell out (`git.rs`); `terminal.rs` and `reveal_path` spawn subprocesses. `docs/MOBILE.md` has the plan (a `RemoteOps` trait with a git2 implementation). |
| Responsive shell CSS | missing | M | Three `@media` rules in the whole app, all in overlays (Settings, Marketplace, Tracker). `Shell`, `LeftPanel`, `Editor`, `TopBar` have none. Sidebar fixed at 260px, right pane 440px, window `minWidth: 800`. |
| Touch handling | missing | M | No pointer or touch events; graph is mouse+wheel; tree DnD is HTML5 only. |

Two backlog rows already cover this: *Mobile mode — responsive shell
groundwork* and *Mobile mode — Tauri 2 mobile feasibility spike*.

## 15. Publishing (vs Obsidian Publish)

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Static site, explicit opt-in per note | done | — | `publish.rs`; `publish: true` or the `public` tag; a write manifest so rebuilds prune only their own output. |
| Wiki links, aliases, heading anchors | done | — | Unpublished targets degrade to plain text so private titles never leak. |
| Callouts | done | — | |
| Embeds | partial | S | `![[note]]` becomes a link, never inlined (deliberate: no unpublished body leaks). |
| Client-side search | partial | S | `search.json` has title and tags only; body text is not searchable. |
| Database / `cortex-view` blocks | missing | M | Rendered as a raw code fence (`publish.rs:333`). |
| Graph on the site | missing | M | |
| GitHub Pages push + Action | done | — | |
| Comments, presence, auth-gated pages | missing, by design | L | "Read-only: no comments, no presence" (`publish.rs:17`). |

## 16. Other

| Feature | Status | Effort | Notes |
|---|---|---|---|
| Obsidian Bases vs Cortex collections | done, well ahead | — | Typed schemas, relations, rollups, a real formula evaluator, recurrence, trackers with streaks, seven view types, same queries from the CLI and MCP. See `notion-parity.md` §4-§6. |
| Math `$…$` / `$$…$$` (MathJax in Obsidian) | done | — | Same syntax on disk, rendered with KaTeX in the editor (`MathBlock.tsx`). `$$` on an empty line or `/math` opens a block; `$…$` typed inline becomes an equation. |
| Audio recorder | missing | M | |
| Slides / presentation mode | missing | M | |
| PDF viewer | missing | L | Images, video and audio render from `assets/`; a PDF shows as a file block (name and link), not inline. |
| Web clipper | missing | L | |
| URI scheme / deep links (`cortex://`) | missing | M | No `tauri-plugin-deep-link`, no scheme registration. |
| Embedded terminal / agent pane | done, beyond Obsidian | — | Real PTY (`terminal.rs`), opens into a detected agent CLI. |
| Export | partial | S | Note → HTML only. No PDF, no Markdown-with-resolved-links. |
| Import an Obsidian vault | done | — | `cortex import markdown <vault> [--into NAME]`, MCP `import_markdown`, **Import…** in the palette (`import.rs`): copies every `.md` under `notes/<name>/` keeping frontmatter and `[[links]]` verbatim, copies referenced images (`![[pic.png]]` too) into `assets/` and rewrites the paths, skips `.obsidian/` and reports every skip; the source vault is never modified. Aliases and heading links are carried as text and hit the §1 limits. |
| `==highlight==`, `<u>`, `<details>` folds, sized `<img>` | done | — | The same on-disk forms Obsidian reads; the editor writes and re-reads them (`richFormats.ts`), and `cortex publish` renders `==…==` as `<mark>`. Highlight colour is not kept. |

## Notable gaps, ranked

1. ~~**Aliases and heading links break navigation and backlinks.**~~ Closed: one parser in cortex-core, shared by every reader.
2. ~~**Rename / move never rewrites inbound links.**~~ Closed: `rename::rename_note` in cortex-core relinks every referrer; app, CLI and MCP share it.
3. ~~**Search has no operators and no snippets.**~~ Done: phrases, `-`, `OR`, `tag:` / `type:` / `path:`, snippets, title boost, FTS fallback in the quick switcher. Still missing: regex, vault-wide replace, find-in-note.
4. ~~**No inline `#tags` and no tag pane.**~~ Done: inline tags are indexed, the sidebar has a tag tree, and every tag opens a page.
5. **No tabs, no splits.** Single-document workspace is a hard blocker for side-by-side reading and writing.
6. **Graph is a static global snapshot.** No local graph, filters, colouring or live physics.
7. **Mobile is a doc, not a target.** Zero mobile config, shell-out git, no breakpoints.
8. **No block references.** The deepest structural gap and the most expensive.
9. **No canvas.**
10. **Small conveniences, individually cheap:** recent files, explorer sort, folder notes, CSS snippets, resizable sidebar, unlinked mentions (outline, word count and find-in-note are done).

## Deliberate non-goals

- **No JS plugin API.** Packs are data. Extensibility is the CLI, MCP, `cortex-view` specs and proposals.
- **No hosted sync.** Git is the sync layer; the relay is optional and never the source of truth.
- **No vim mode** in the editor (ProseMirror, not CodeMirror).

What Cortex has that Obsidian lacks: typed databases with formulas, rollups and trackers; an MCP server and CLI with the app's semantics; agent proposal branches with an in-app diff review; an embedded terminal; live Yjs collaboration; a live desktop-palette theme.
