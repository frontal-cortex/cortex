# Template marketplace — plan

Give a new vault the ten templates people actually reach for in Notion and
Obsidian, installable in one click, in the same materials a vault is already
made of: Markdown and YAML. No plugins, no JavaScript, nothing that stops
working if the user leaves Cortex.

Status: content drafted (`marketplace/`, 2026-09-08, ten packs). Installer,
UI, and distribution not started.

## The ten packs

What the two apps' galleries and community lists converge on, and what Cortex
already has the machinery for (templates with `{{date}}`-style variables,
typed-property schemas, collections with table / board / calendar views).

| # | Pack | Kind | Where it comes from | Status |
|---|------|------|---------------------|--------|
| 1 | Daily note | note | Obsidian's core habit; Notion "Daily journal" | drafted |
| 2 | Weekly review | note | Both; GTD lineage | drafted |
| 3 | Meeting notes | note | Notion's most-duplicated work template | drafted |
| 4 | Book / reading notes | note | Notion reading list; Obsidian literature note | drafted |
| 5 | 1:1 / person note | note | Notion 1:1; Obsidian "people" notes | drafted |
| 6 | PARA index | note | Building a Second Brain; both communities | drafted |
| 7 | Project tracker | database | Notion's #1 database template | drafted |
| 8 | Habit tracker | database | Notion; Obsidian Dataview equivalents | drafted |
| 9 | Budget / expense tracker | database | Notion finance templates | drafted |
| 10 | **Tasks** | database | Notion's most-used database of all; Obsidian Tasks plugin | **replace Recipe Box** |

Recipe Box is charming but is not a top-ten template anywhere. A Tasks
database (title, status, priority, due, project) with a board view is, and
it exercises the calendar view. Keep Recipe Box in the repo as pack eleven;
the catalog is not limited to ten.

Near misses worth a second batch: content calendar, job-applications
tracker, contacts / lightweight CRM, goals / OKRs, Zettelkasten literature
note, map of content (MOC).

## What a pack is

```
marketplace/packs/<id>/
├── manifest.yaml     # id, name, description, kind, tags, version, files
├── templates/*.md    # → <vault>/templates/            (note packs, and the row template of database packs)
├── schemas/*.yaml    # → <vault>/.cortex/schemas/      (database packs)
├── index.md          # → <vault>/collections/<name>/_index.md  (views: table / board / calendar)  ← missing today
└── seed/*.md         # → <vault>/collections/<name>/   (one or two rows so the table is not empty)
```

Two additions to the drafted format:

- **`index.md` with views** for database packs. Today the four database
  packs ship a schema and a seed row but no `_index.md`, so nothing gives the
  collection its table / board / calendar views. The views are half the value
  of a Notion database template; each pack should declare them.
- **A row template** for database packs (`templates/<name>.md` with the
  schema's properties pre-filled), so "New row" from the pack's table has the
  right shape and the template also appears under New from template.

Everything a pack installs is a plain file the user can read, edit, commit,
and delete. That is the whole pitch: a template is not a black box.

## Installing

`cortex_core::marketplace`:

- `catalog()` — the packs bundled into the binary (the way the starter vault
  is bundled: compiled in, works offline, versioned with the app). The
  `marketplace/` directory in the repo is the source of truth; a build step
  embeds it.
- `install(root, id, force)` — copies the pack's files into the vault. Never
  overwrites an existing file unless forced; reports every path written.
  Records the install in `.cortex/packs.yaml` (`id`, `version`, `files`), so
  `remove` can delete exactly what was installed and nothing the user added
  since, and so the app can show "installed".
- `remove(root, id)` — deletes the recorded files that are unchanged since
  install; leaves edited ones and says so.
- `lint(pack_dir)` — validates a pack: manifest complete, every listed file
  present, frontmatter parses, placeholders are the supported ones, schema
  types are known, `index.md` views reference existing properties. Runs in
  CI over `marketplace/` and is the gate for community packs later.

Nothing is installed automatically. Installing writes files into the vault;
the user's auto-commit or next sync carries them like any other change.

Surfaces:

- **CLI** — `cortex packs list`, `cortex packs show <id>`,
  `cortex packs install <id> [--force]`, `cortex packs remove <id>`,
  `cortex packs lint <dir>`. `--json` everywhere.
- **MCP** — `list_packs`, `install_pack`. An agent asked to "set up a habit
  tracker" can do it; the result is ordinary files the user sees at once.
- **App** — a full-window Marketplace page (same shell as Settings: nav on
  the left by kind / tag, cards on the right). Each card: name, one-line
  description, tags, a rendered preview of the template or the table's
  columns and views, an Install button that becomes Installed. Reached from
  the command palette (*Browse templates…*), the Templates section header,
  and the Getting-started card's "Try a template" step.

## Distribution

1. **Bundled** (first release). The ten packs ship inside the binary. No
   network, nothing to trust, updates arrive with the app.
2. **Remote index** (second). `frontal-cortex/marketplace` on GitHub holds
   the same `marketplace/` tree; the app fetches `index.yaml` on demand,
   caches it, and installs a pack by fetching its files. Bundled packs stay
   as the offline fallback. Community packs arrive as pull requests to that
   repo; `cortex packs lint` runs in its CI, and a maintainer merges.
3. **Later, backlog** — ratings and install counts (needs the hosted
   service), paid packs, packs that carry a theme or keybindings.

## Sequencing

| Phase | Work | Effort |
|-------|------|--------|
| 0 | Curate: replace Recipe Box with Tasks in the top ten, add `index.md` views and a row template to each database pack, tighten descriptions, proofread the six note templates against their Notion / Obsidian originals | ½ day |
| 1 | Core `marketplace` module (catalog, install, remove, lint, `.cortex/packs.yaml`), bundling, `cortex packs`, MCP tools, tests, docs | 1–2 days |
| 2 | Marketplace page in the app, palette action, Getting-started hook, Installed state | 1–2 days |
| 3 | `frontal-cortex/marketplace` repo, remote index with cache and fallback, lint in CI, contributor guide | 1 day |

Phases 0 and 1 are independent of the UI and can go to the overnight
orchestrator as backlog rows.

## Decisions to confirm

- Swap Recipe Box for Tasks in the top ten (Recipe Box stays as pack 11).
- Name: "packs" in the CLI and file format; "templates" in the UI, since
  that is the word users search for.
- Bundled first, remote second — so the first release has no network path.
- Database packs install their views (`_index.md`) and a row template, not
  just a schema.
