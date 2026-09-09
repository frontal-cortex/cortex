# Cortex Roadmap — toward Notion parity, the local-first way

This document tracks the features we want to build to make Cortex a credible
Notion alternative **without ever betraying the project's ethos**. It is plain
text, committed to the repo, and versioned like everything else — the plan is as
portable as the data.

## Guiding principles (every feature must satisfy these)

1. **Files are truth. `.brain/` is a throwaway cache.** Every feature must
   survive `rm -rf .brain/` with no data loss — only a rebuild.
2. **Never write derived or volatile data into notes.** Rollups, link-preview
   metadata, tab/session state, search rank — all computed and cached in
   `.brain/`, never serialized into a `.md` file (it goes stale and pollutes
   diffs).
3. **Markdown-first and degradable.** Every block must render acceptably in
   GitHub / Obsidian / a plain text editor without Cortex. Prefer established
   conventions: GFM, `> [!note]` admonitions, `<details>`, `$$…$$` math.
4. **Config is committed, human-readable YAML.** Schemas, views, and settings
   live as plain files in the repo (`.cortex/`), not as opaque DB rows.
5. **Diffs stay clean.** Frontmatter keys stay sorted; an edit to one field
   should touch one line in one file.

## Storage layout

```
my-vault/
├── notes/                 ← notes (each .md = one note / one "row")
│   └── projects/
│       ├── .collection.yaml   ← (future) collection schema
│       └── .views.yaml        ← (future) saved views
├── templates/             ← note templates ({{date}}, {{title}}, …)
├── assets/                ← images & files (referenced by relative path)
├── .trash/                ← soft-deleted notes + restore metadata (committed)
├── .cortex/               ← COMMITTED user config (portable, readable)
│   ├── settings.yaml
│   ├── favorites.yaml
│   └── properties.yaml        ← (future) typed-property registry
├── .brain/                ← GITIGNORED cache (safe to delete, rebuilt on open)
│   ├── index.db               ← FTS + links + (future) property index
│   ├── ui-state.json          ← open tabs, last note (disposable)
│   └── previews/              ← (future) cached bookmark/link previews
└── VAULT.md
```

`.cortex/` vs `.brain/` is the load-bearing distinction: **`.cortex/` is
authored config you'd want on another machine; `.brain/` is a rebuildable
cache.** `open_vault` ensures `.gitignore` contains `.brain/`.

---

## Status legend

`[ ]` planned · `[~]` in progress · `[x]` done · effort: S / M / L

---

## Tier 1 — the features that *define* Notion

### #1 Databases / collections with views  · effort: L · `[ ]`
A **collection is a folder**; each note is a **row**; **columns are frontmatter
keys**. Nothing new is stored per row.

- `notes/<coll>/.collection.yaml` — committed schema (name, typed properties).
- Rows = each note's existing frontmatter. Zero duplication.
- `notes/<coll>/.views.yaml` — committed view definitions (table / board /
  gallery / calendar; filter / sort / group). Pure presentation.
- Backend: `read_collection`, `list_collection_rows`. Filter/sort/group
  client-side first; later add a `props` JSON column to the index for scale.
- Frontend: view switcher; editable table grid (cell edit → one frontmatter
  line); board with drag (drag card → update one property). Every row opens as a
  real note.
- Diff shape: cell edit = 1 line; new row = new file.
- Phases: table → board → gallery/calendar → filter UI → DB-backed scale.

### #2 Typed properties  · effort: M · `[ ]`
- Storage stays frontmatter. Types declared in the collection schema or a
  vault-wide `.cortex/properties.yaml` registry. **The value in the file is
  canonical; the registry is advisory** (unknown values render uncolored, never
  rejected).
- Types map to native YAML: text/select/url = string, number = number,
  checkbox = bool, date = `YYYY-MM-DD`, multi_select = list. **Colors live in
  the schema, never in the note.**
- Frontend: upgrade `PropertiesPanel` to typed editors (date picker, number,
  colored select chips, checkbox).

### #3 Relations & rollups  · effort: M–L · `[ ]`
- Relation = a frontmatter property holding `[[wiki-links]]`. Reuses link
  resolution, graph, and backlinks; degrades everywhere.
- Index change: extract `[[…]]` from frontmatter values too (today only the
  body is scanned). Cache only.
- **Rollups are computed, never written** — defined in schema, evaluated from
  the index, rendered read-only.

> **Note:** The #2 → #1 → #3 "database arc" is intentionally deferred. It is the
> largest, most schema-heavy work and is sequenced after the foundation and the
> git-native wins below.

### #4 Nested / sub-pages  · effort: M · `[ ]`
- **Folder-note convention:** `notes/projects.md` is the page; `notes/projects/`
  holds its children (Obsidian-compatible).
- Inline page block serializes to plain `[[Child]]` / `[title](rel/path.md)`.
  `/page` creates the child note and inserts the link.
- Child list auto-rendered from the folder (derived, nothing stored).
- Backend: `create_child_note(parent_path, title)`.

### #5 Richer blocks  · effort: M · `[ ]`
Editor currently uses the default BlockNote schema. Add custom blocks, each
round-tripping to **degradable** markdown:

| Block    | Serialization                                              |
|----------|-----------------------------------------------------------|
| Toggle   | `<details><summary>…</summary>…</details>`                 |
| Callout  | `> [!note]` / `[!warning]` (GFM / Obsidian admonition)    |
| Divider  | `---`                                                      |
| Bookmark | plain `[title](url)`; preview card cached in `.brain/`     |
| Math     | `$…$` / `$$…$$` (KaTeX)                                    |
| Columns  | HTML wrapper; degrades to stacked. Opt-in (weakest fit).  |

---

## Tier 2 — git-native wins (where we can *beat* Notion)

### #6 Per-note history + restore  · effort: S–M · `[ ]`
Git already stores every version; surface it.
- Backend (git2): `note_history(path)` (revwalk by pathspec),
  `note_at(path, hash)` (read blob from tree), `restore_note(path, hash)`
  (write historical blob → normal save/commit; non-destructive).
- Frontend: History button → version timeline → diff vs current (reuse
  `CommitDiffModal`) → Restore.
- **Highest value-to-effort. Build first.**

### #7 Trash / soft-delete  · effort: S · `[ ]`
- `delete_note` moves to `.trash/notes/<path>` + `.trash/<id>.meta.yaml`
  (original path, deleted_at). Committed, so it syncs and restores on any clone.
  Auto-prune after N days (setting).
- Backend: `list_trash`, `restore_trashed`, `empty_trash`.
- Frontend: Trash sidebar section; drop the scary `confirm()`.

### #8 Tabs + back/forward  · effort: M · `[ ]`
- Replace single `selectedPath` with a history stack + tab bar.
- Wire ⌘[ / ⌘] and mouse back/forward.
- Persist open tabs to `.brain/ui-state.json` (disposable, no diffs).
- Pure frontend; no file-format impact.

### #9 New-from-template + variables + daily notes  · effort: S–M · `[ ]`
- Backend: `create_note_from_template(name, dir, vars)` substituting
  `{{date}}`, `{{title}}`, `{{time}}`, `{{uuid}}`.
- Frontend: "New from template" picker + a "Today" button
  (`settings.journal_template` → `notes/journal/<date>.md`).
- Also fixes templates with `{{placeholder}}` frontmatter currently breaking the
  YAML parse in `list_notes`.

### #10 Cover images + custom icons  · effort: S · `[ ]`
- `icon` frontmatter accepts emoji (current) **or** `assets/icon-x.png`; add
  `cover: assets/cover.jpg`. Both via existing `save_asset` (committed, relative
  paths). Editor renders a banner + icon upload.

### #11 Command palette  · effort: S · `[ ]`
- Expand ⌘K into two modes — notes + actions (`>` prefix): New,
  New-from-template, Today, Toggle theme, Graph, Commit, Sync, Settings.
- Frontend only; calls existing commands.

---

## Tier 3 — nice-to-have

- **Outline / TOC**: derive headings → right rail. Nothing stored. · S
- **Tag browser**: `list_tags()` (GROUP BY) + sidebar section / tag page (a
  saved filter view). · S–M
- **Daily notes**: mini-calendar over `notes/journal/YYYY-MM-DD.md`. · S–M
- **@-mentions**: reuse wiki-link suggestion infra; `@page` → `[[…]]`,
  `@today` → ISO date. · S
- **Comments**: sidecar `notes/foo.comments.yaml` (committed, text-quote
  anchors) keeps note bodies clean; render as margin notes. · M · `[x]`
- **Export / Publish**: export to PDF/HTML; "Publish" = a static site built
  from the vault (see Publishing below). · S–M
- **Theme toggle**: explicit light/dark/system in `.cortex/settings.yaml`. · S

---

## Publishing (decided 2026-09-08)

Notes can be put on the internet for others to read. Two hosting models,
one build. Private by default: a note is published only with
`publish: true` in its frontmatter (or a `public` tag); site-level settings
are the `site_title` / `site_home` keys in `.cortex/settings.yaml` (one
config file), so agents can mark notes through files too — but only a person
builds or pushes the site.

**Now — static site generator in `cortex-core`, `cortex publish --out DIR`.**
One HTML page per published note, assets, an index, a search JSON. Wiki links
become slugs; a link to an unpublished note degrades to plain text so nothing
leaks. Database views render as static tables. Read-only: no comments, no
presence. Self-host targets, cheapest first: a folder for any static host, a
`gh-pages` branch pushed with git, a bundled GitHub Action template that runs
`cortex publish` on push. Netlify / Cloudflare Pages need no extra code.
Renderers still to add on top of plain Markdown: callouts, embeds, database
blocks. · M

**Backlog — hosted service (`cortex.site`), a separate repo.** Because the
vault is git, the interface is a git remote: add it, push, the server runs
the same `cortex publish` and serves `name.cortex.site`. Payment gates the
remote (no active subscription → push rejected with a link to pay); Stripe
Checkout for cards, Lightning if true micropayments are wanted. Server state
is just repo, build output, paid-until. Depends on the generator; not
started. · L

## Suggested sequencing

1. **Prerequisite** — `.gitignore` + `.cortex/` config split. Unblocks portable
   config.
2. **#6 history/restore + #7 trash** — fast, leans on the git differentiator.
3. **#9 templates**, **#11 command palette**, **#8 tabs**, **#10 covers** —
   high-value polish, mostly frontend.
4. **#5 rich blocks**, **#4 sub-pages** — editor depth.
5. **Tier 3** opportunistically.
6. **#2 → #1 → #3 database arc** — the largest project, sequenced last.
