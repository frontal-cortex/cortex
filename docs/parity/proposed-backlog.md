# Proposed backlog — closing the Notion / Obsidian gaps

Fifteen rows, each sized for one unattended agent session, drawn from
`notion-parity.md` and `obsidian-parity.md` (audited 2026-09-09 at
`e728bc8`). Each block below is a complete backlog row: paste the
frontmatter and body into a new file under `collections/backlog/`, or
run `cortex new "<title>" --dir collections/backlog` and set the
properties. `priority` continues after the existing rows (lower runs
sooner); reorder freely.

Ordering logic: cheapest fixes to things that *look* broken first
(links, search, code, formatting loss), then the database editing gaps,
then import, tags, and the two mobile steps that follow the existing
mobile rows.

Every row keeps the vault rules: files are truth, nothing derived is
written into a note, every block degrades to legible Markdown, and the
Rust core, CLI, MCP and app share one code path.

---

```markdown
---
created: 2026-09-09
effort: S
priority: 20
status: planned
tags: [parity, links]
title: Wiki links — aliases and heading links resolve everywhere
type: note
---

`[[Note|alias]]` and `[[Note#Section]]` only work in the static-site
builder (`publish.rs:268-289`). In the app a click is a silent no-op
(`Shell.tsx` `handleNavigate` never splits on `|` or `#`) and the indexer
stores the raw inner text (`note.rs:88`), so no backlink is recorded.
Extract one `parse_wiki_link(&str) -> {target, alias, section}` into
`cortex-core` and use it from the indexer, `vault.rs` resolution, the
Tauri `resolve_ref` command, the editor decoration (render the alias as
the label) and the `@`/`[[` suggestion insert. Backlinks must match on
the target alone. Add core tests for the three forms plus `![[embed#h]]`.
Do not change what is written to disk.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 21
status: planned
tags: [parity, links]
title: Rename or move a note and rewrite every inbound link
type: note
---

`rename_note` and `move_note` (`src-tauri/src/commands/notes.rs:323`,
`:410`) rename the file and reindex; links resolve by title, so changing a
title orphans every `[[Title]]` pointing at it, and the three resolvers
(`vault.rs:342`, `commands/notes.rs:117`, `Shell.tsx handleNavigate`)
disagree (two use substring stem matching). Do this in `cortex-core`:
one resolver used by all three callers, exact stem match only, and a
`rewrite_links(old_target, new_target)` that uses the `links` table to
find referrers and rewrites `[[old]]`, `[[old|alias]]`, `[[old#h]]` and
`![[old]]` in their bodies, preserving alias and section. Wire it into
rename, move and title edits in the editor (title change = rename target).
One commit per rename when auto-commit is on. Tests over a small fixture
vault. Expose as `cortex mv`.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 22
status: planned
tags: [parity, search]
title: Search — operators, snippets, and a quick switcher that uses FTS
type: note
---

`fts_query` (`crates/cortex-core/src/db.rs:215`) strips every
non-alphanumeric character and appends `*` per word, so quoted phrases,
`OR`, `-exclude`, `tag:x`, `path:x` and `type:x` are all impossible, and
results carry no snippet. Build a small query translator in core:
quoted phrases become FTS5 phrases, `-word` becomes `NOT`, `OR` passes
through, `tag:`/`type:`/`path:` become a join against the `notes`
columns (add `tags` to the FTS table or filter after). Return
`snippet(notes_fts, 2, ...)` with the match highlighted and show it under
each result in the sidebar. Boost title matches over body. Make the
quick switcher fall back to FTS when the substring match on titles finds
nothing, so a note is reachable by a word in its body. Same behaviour in
`cortex search` and the MCP `search` tool. Tests for each operator.
```

```markdown
---
created: 2026-09-09
effort: S
priority: 23
status: planned
tags: [parity, editor]
title: Code blocks — syntax highlighting and a language picker
type: note
---

The app creates `createCodeBlockSpec()` with no options
(`src/components/Shell/schema.ts`), so there is no language dropdown and
no highlighting; only the fence language survives the parse. Configure
`supportedLanguages` (a curated list of ~30) and a `createHighlighter`
using shiki with a small bundled grammar set, themed from the app's
tokens so it follows light/dark and the Omarchy palette. Keep the
Markdown output an ordinary ` ```lang ` fence. Check bundle size (lazy
load the highlighter) and confirm the terminal pane fonts still apply.
Screenshot a note with three languages in both themes.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 24
status: planned
tags: [parity, editor]
title: Math — inline and block equations with KaTeX
type: note
---

No math support anywhere (no KaTeX dependency, no `$` handling). Add an
inline math style/node and a block math block to the BlockNote schema
that round-trip to `$…$` and `$$…$$` (the roadmap's chosen form, GitHub
and Obsidian compatible). Render with KaTeX, bundled locally (no CDN), CSS
scoped to the editor. Slash item `/math`, and typing `$$` on an empty
line opens a block. Boundary translators live next to the existing
`inflate*/flatten*` helpers in `Editor.tsx`. The static site
(`publish.rs render_body`) should render the same with KaTeX CSS or leave
the source visible; do not ship a broken half. Tests for the
inflate/flatten pair.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 25
status: planned
tags: [parity, editor]
title: Formatting that survives a save — toggles, highlight, underline, image width
type: note
---

Several things work on screen and vanish on reopen because
`blocksToMarkdownLossy` drops them: toggle lists/headings flatten to a
bullet or heading, underline and highlight spans are stripped, image
`previewWidth` is lost. Decide and implement a degradable form for each:
toggles as `<details><summary>…</summary>…</details>` (roadmap #5),
highlight as `==text==`, underline as `<u>…</u>`, image width as a
`{width=480}` attribute or an HTML `<img width>` fallback. Either replace
the lossy exporter with a custom serializer for these cases or
post-process the block tree before export and pre-process on parse, as
the callout block already does. Text colour is out of scope (document
it as a non-goal in the parity doc). Round-trip tests: open, save
without edits, byte-identical file.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 26
status: planned
tags: [parity, databases]
title: Rename and delete a property across the schema and every row
type: note
---

`upsert_property` is the only schema mutation; there is no rename or
delete anywhere (`src-tauri/src/commands/schema.rs`), so a mistyped
property is permanent from the app. In `cortex-core` add
`rename_property(key, old, new)` and `delete_property(key, name)` that
update `.cortex/schemas/<key>.yaml`, rewrite the frontmatter key in every
row of that collection (sorted keys, one line changed per file), and fix
references in the collection's views (`columns`, `sort`, `filter`,
`group`), rollup `property`/`via`, and formula identifiers. Refuse to
delete a property another schema's rollup depends on; say which. Expose
in the column header menu, the properties panel, `cortex schema rename /
rm`, and MCP. Tests over a fixture with rollups and a view.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 27
status: planned
tags: [parity, databases]
title: Filter grammar — precedence, parentheses, and the missing operators
type: note
---

`parse_filter` (`crates/cortex-core/src/data.rs:441`) is left-to-right
with no precedence, so `a or b and c` silently returns the wrong rows,
and the operator set stops at `== != > >= < <= contains`. Rewrite the
parser as a small precedence climber: `and` binds tighter than `or`,
parentheses group, `not` prefix. Add `is_empty`, `is_not_empty`,
`starts_with`, `ends_with`, `does_not_contain`, `in [a, b]`, and date
`within` (`deadline within 7d`, using the existing `@today` machinery).
Keep every existing pack filter parsing unchanged (run `cortex packs lint`
over the marketplace checkout as the regression test). Update the toolbar
filter UI to offer the new operators and to round-trip a single
parenthesised group; deeper nesting stays raw-edit. Update
`docs/habit-tracker.md` / `AGENTS.md` grammar notes.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 28
status: planned
tags: [parity, databases]
title: Table view — group by, and a summary row
type: note
---

`group:` is read only by the board (`ViewToolbar.tsx` gates the Group
control on `isBoard`); the table renders one flat body, and the footer
shows only a row count. Make `group` work in the table view: one
collapsible section per group value in schema option order, empty group
last, per-group count, "add row" inside a group pre-fills the group
value (reuse `seedFromFilter`). Add a per-column summary row configured
in the view spec (`summary: {amount: sum, done: percent_checked}`) with
count, sum, avg, min, max, percent_checked, empty, not_empty, computed in
the Rust engine so `cortex view` and MCP return the same numbers. Nothing
is written to any row. Timeline and gallery untouched.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 29
status: planned
tags: [parity, databases, keyboard]
title: Table editing — keyboard navigation, a date picker, duplicate row
type: note
---

The data table is mouse-only: no arrow-key movement, no Tab to the next
cell, no Enter to open a row (`CortexViewBlock.tsx` `EditableCell`
handles only Enter/Escape inside an open editor). Date cells and the
properties panel are bare text inputs that accept `2026-13-45`. Add a
roving focus over cells (arrows, Tab/Shift-Tab, Home/End, Enter edits,
Escape cancels, `o` or Ctrl+Enter opens the row, `n` new row, Delete
trashes with the existing confirm), consistent with the sidebar's vim
keys and registered in `keymap.ts`. Add a date picker component used by
date cells, the properties panel and the calendar "add" flow; typed input
still allowed but validated. Add "Duplicate" to the row menu (copy
frontmatter and body, new id, `created` today) and wire the existing
`saveRowAsTemplate` binding, which has no caller, into the same menu.
Screenshot the focus ring.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 30
status: planned
tags: [parity, import]
title: Import — CSV into a collection, and a Markdown folder into notes
type: note
---

There is no import path at all. Two importers in `cortex-core`, both
exposed as `cortex import csv|markdown`, MCP tools and a palette action.
CSV: pick a file, choose target collection (new or existing), map
columns to properties with type inference (`infer_columns` already
exists), one row file per line named from the title column, schema
written or merged, preview the first five rows before writing, report
counts. Markdown folder: copy `*.md` (and referenced images into
`assets/`) under `notes/<chosen>/` without touching the source folder,
keep frontmatter, convert `[[links]]` as-is, rewrite relative image paths,
skip `.obsidian/` and other dotdirs, report skipped files. Neither
importer writes anything derived. Land as one commit so it can be
reverted, or as a proposal branch when run by an agent.
```

```markdown
---
created: 2026-09-09
effort: L
priority: 31
status: planned
tags: [parity, import]
title: Import — a Notion export zip becomes notes and collections
type: note
---

The biggest adoption blocker: a Notion user cannot bring their workspace.
A Notion "Markdown & CSV" export is a zip where pages are `Title <hash>.md`,
databases are `Title <hash>.csv` (plus a `_all` variant) with a folder of
row pages, links are relative paths with `%20` and the hash suffix, and
properties appear as a leading key: value block in each page. Build
`cortex import notion <zip>` on the CSV and Markdown importers from the
previous row: strip hashes from names, turn each CSV + row folder into a
collection with a schema inferred from the CSV header and cell values
(select, multi-select, date, checkbox, url, number, relation by title),
convert the property block into frontmatter, rewrite intra-export links
to `[[Title]]`, keep images in `assets/`, and write an import report note
listing what could not be mapped. Fixture: a small hand-made export
checked into `crates/cortex-core/tests/fixtures/`. Idempotent re-runs
into an empty folder.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 32
status: done
tags: [parity, tags]
title: Tags — inline #tags in the body, a tag pane, and tag pages
type: note
---

Tags exist only as a frontmatter list; the body is never scanned for
`#tag`, tags are opaque strings (no `parent/child`), and the sidebar has
no tag section (`LeftPanel.tsx` sections are favorites, notes, templates,
trash). Index inline `#tags` from the body alongside wiki links
(`note.rs` `extract_wiki_links` is the model; skip code fences, URLs and
`#` headings), store them in the existing `notes.tags` column merged
with frontmatter tags, and expose `list_tags()` with counts and nesting
by `/`. Add a Tags sidebar section (tree by `/`, counts, keyboard
navigable like the note tree) and a tag page: clicking a tag opens a
saved-filter view of matching notes, nothing written. Autocomplete `#`
in the editor from `list_tags`. Update `cortex ls --tag` and the MCP
`list_notes` filter to include inline tags.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 33
status: planned
tags: [parity, editor]
title: Editor chrome — outline pane, find in note, word count
type: note
---

Three small Notion/Obsidian staples with zero code: no outline, no
Ctrl+F, no word count. Outline: derive headings from the open note's
blocks into a collapsible panel (right column, above backlinks, or a
toggle in the top bar), click scrolls to the heading, follows the cursor.
Find in note: a small bar bound to `find-in-note` in `keymap.ts`
(default mod+f), match count, next/previous, highlights via a ProseMirror
decoration, Escape closes; must not collide with the sidebar `/` search.
Word count and reading time in a quiet status line at the bottom of the
editor column, hidden in monk mode. Nothing stored. Screenshot all three.
```

```markdown
---
created: 2026-09-09
effort: L
priority: 34
status: done
tags: [parity, mobile]
title: Mobile — in-process git transport (RemoteOps) with desktop tests
type: note
---

Phase 1 of `docs/MOBILE.md`, and the load-bearing refactor for any mobile
build: pull, push, merge abort, ours/theirs, complete-merge and the
identity lookup all shell out to `git` (`crates/cortex-core/src/git.rs`,
`members.rs`). Introduce the `RemoteOps` trait from the doc with a
`ShellRemote` (the current code, lifted verbatim, `#[cfg(desktop)]`) and a
`Git2Remote` (libgit2: HTTPS + token credentials, fetch + merge writing
the same conflict markers, conflict listing from the index, ours/theirs
from conflict entries, abort via saved pre-merge OID, complete via a
two-parent commit). Desktop behaviour must stay byte-for-byte the same.
Unit-test `Git2Remote` on desktop against a local bare repo: clean sync,
conflict, resolve both ways, abort. Do not touch UI or tauri config;
that is the feasibility spike's and the responsive-shell row's job.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 35
status: done
tags: [parity, mobile]
title: Mobile — touch input and phone-width database views
type: note
---

Follows "Mobile mode — responsive shell groundwork" (which handles the
shell, sidebar and editor). Database views assume a mouse and a wide
window: table rows use HTML5 drag-and-drop, board cards drag with the
same, the graph pans with mouse events only, and the table has fixed
`min-width: 150px` columns. Using the breakpoint system from the shell
row: table becomes a card list below ~600px (title plus the first three
visible columns), board scrolls horizontally with snap, calendar
collapses to a week strip, timeline gets pinch/drag zoom. Replace mouse
handlers with pointer events (`onPointer*`, `touch-action`) in the
graph, tree, board and timeline so touch and mouse share one path; hit
targets ≥ 44px. Verify with screenshots at 390x844 of each view type.
No Tauri mobile build in this task.
```

---

The Android feasibility spike (`mobile-spike.md`, done 2026-09-09) adds
four more mobile rows, priorities 36–39, and the order they run in
relative to the two above: 36 → 34 → 37 → responsive shell → 38 → 35 → 39.

## Next in line (not sized as rows yet)

- ~~**Comments as a committed sidecar**~~ Done: `notes/foo.comments.yaml`, text-quote anchors, a margin panel, `cortex comment`, MCP `add_comment`.
- ~~**Publish database views**: render `cortex-view` fences as static tables on the site, and index body text into `search.json`. M.~~ Done.
- ~~**CI and auto-update**: a `.github/` build matrix for the three desktop OSes plus `tauri-plugin-updater`. Not parity, but today nobody can receive a build. M.~~ Done: `.github/workflows/{ci,release}.yml`, updater plugin, Check for updates in palette + Settings; keypair setup in `docs/development.md`.
- ~~**Bookmark block** with a `.brain/` preview cache, and a plain iframe embed block. M.~~ Done: `[Label](url)` alone is a card, `<url>` alone is a frame; previews in `.brain/previews/`.
- **Tabs and split panes.** L, and tabs were removed once after a history bug; needs a design first.
- ~~**Calendar week view, in-database search box, list view.**~~ Done: month / week / day modes with multi-day spans, a client-side search box in the view toolbar, and `type: list`.
- ~~**Resizable sidebar, recent files, explorer sort, `?` shortcut overlay.** S each.~~ Done: drag handle (200–480px, per-vault), Recent section + `.brain/ui-state.json`, `explorer_sort` setting with a header menu, `?` / `mod+/` overlay from the keymap registry.
