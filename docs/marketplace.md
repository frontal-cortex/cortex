# Template marketplace — the full plan

From a marketplace repository of curated packs, through installation,
updates and removal, to community submissions with review, trust tiers and
a contributor flow. Everything a pack installs is Markdown and YAML — the
same materials a vault is already made of — so a template is never a black
box, never code, and keeps working in any other Markdown tool.

Status 2026-09-08: every phase built. The packs live in
[`frontal-cortex/marketplace`](https://github.com/frontal-cortex/marketplace)
(fifteen official ones — the ten featured, Recipe Box, and a second batch:
Decision Log, Contacts, Goals, Content Calendar) with lint / index / preview
tooling and CI; this repo vendors a snapshot of the official tier into
`crates/cortex-core/` (`tools/sync-packs.sh <tag>`, currently `v0.1.0`). The
installer is `cortex_core::marketplace`, reached from the Marketplace page
(`mod+shift+b`), `cortex packs …` and the MCP pack tools. One thing is not
live: the marketplace repo is private and the organisation is on GitHub's
free plan, which has no Pages for private repos — so the official index at
`OFFICIAL_INDEX` 404s and the app shows its bundled packs until the repo is
made public (`gh repo edit frontal-cortex/marketplace --visibility public
--accept-visibility-change-consequences`, then Settings → Pages → Source:
GitHub Actions, then a `PAGES_ENABLED=true` repository variable). Section 1
is kept as the record of what the first draft got wrong.

---

## 1. Review of the current draft

**Keep.** The format is right in spirit: a pack is a folder with a manifest,
`templates/`, `schemas/`, `seed/`. The pack choice is close to the real top
ten. Descriptions explain *why* a template exists, which the galleries of
both apps mostly fail to do.

**Fix before anything ships.**

| Finding | Where | Fix |
|---|---|---|
| Database packs have no views. A schema and a seed row make a table with no `_index.md`, so the collection gets no table / board / calendar and does not even appear as a database until something creates that file. The views are half of what a Notion database template *is*. | all four `kind: collection` packs | Each ships `index.md` → `collections/<name>/_index.md` with `views:`. |
| No row template. New row from the pack's table has no shape; the pack is also invisible under New from template. | collection packs | Each ships `templates/<name>.md` with the schema's properties pre-filled. It installs as the collection's row template, `collections/<name>/_template-<name>.md`, where the table's New row menu finds it; `{{date}}`, `{{time}}`, `{{title}}` and `{{uuid}}` are expanded when a row is made from it. |
| Seed rows hardcode `created: 2026-09-08`. | all `seed/*.md` | Use `{{today}}`, substituted at install (the starter vault already does this). |
| `created: {{date}}` and `title: "1:1 — {{title}}"` — the first is unquoted. `{{…}}` unquoted is a YAML flow mapping; the app tolerates it (it substitutes before parsing, and the sidebar falls back to the filename) but the vault's own docs say to quote placeholders. | daily, meeting, book, one-on-one, para | Quote every placeholder in frontmatter. `lint` enforces it. |
| Habit tracker models "this week" as seven checkbox columns. It needs a manual reset every week and keeps no history, so the calendar view and any streak are meaningless. | habit-tracker | One row per habit per week: `habit` (select or relation), `week` (date, Monday), the seven checkboxes, `streak` dropped (compute later, or leave to the weekly review). Calendar view on `week`. |
| Meeting notes carries `attendees: []` in frontmatter *and* a bold "Attendees:" line in the body. | meeting-notes | Keep one. Frontmatter `attendees` as a `person` property once Members exist; body line otherwise. |
| Book notes is a note, but the Notion original (and what people want) is a reading *list*: a database with status, rating, author, dates. | book-notes | Make it a collection pack (`reading-list`) whose row template is the current note. |
| Recipe Box is not a top-ten template anywhere. | catalog | Replace with **Tasks** (title, status, priority, due, project) — Notion's most-used database and the Obsidian Tasks plugin's whole purpose. Keep Recipe Box as pack eleven. |
| Descriptions name third-party products and people ("Thomas Frank's Ultimate Brain", "Wine Tracker in every roundup"). Fine as *inspiration*, risky as marketing copy on a marketplace. | book-notes, para-index, recipe-box, budget | Move attribution to a `credits:` field in the manifest; descriptions describe the pack. |
| `index.yaml` duplicates every manifest by hand and will drift. | `marketplace/index.yaml` | Generated from manifests by `cortex packs index`; CI fails if stale. |
| `manifest.yaml` lacks the fields a marketplace needs: license, minimum app version, homepage, preview, credits, a schema version. | all manifests | See the format in section 3. |
| The README says packs "install straight into a vault". Nothing installs them yet. | `marketplace/README.md` | Becomes the contributor guide in the marketplace repo (section 4). |

**The ten**, after the swaps: daily note, weekly review, meeting notes,
1:1 person note, PARA index (notes); tasks, project tracker, reading list,
habit tracker, budget tracker (databases). Recipe Box is eleven. Second
batch: content calendar, job applications, contacts, goals / OKRs,
Zettelkasten literature note, map of content.

---

## 2. Principles

1. **Packs are data, never code.** Markdown, YAML, and images. No scripts,
   no plugins, no network at note-creation time. This is what makes a
   community marketplace safe to run without sandboxing anything.
2. **Every installed file is visible and ordinary.** It lands in
   `templates/`, `.cortex/schemas/`, `collections/<name>/`. The user can
   read it, edit it, commit it, delete it. Uninstall removes only what
   install wrote and only if it is unchanged.
3. **Nothing installs, updates, or phones home on its own.** Install is a
   click or a command. Updates are offered, never applied. The index is
   fetched when the user opens the marketplace, not on launch.
4. **Bundled first.** The official packs ship inside the app, so the first
   release, an offline machine, and a locked-down company laptop all work.
   The network is an addition, not a dependency.
5. **Same code everywhere.** Catalog, install, lint live in `cortex-core`;
   the CLI, the MCP server, the app, and the marketplace repo's CI all call
   the same functions. A pack that passes `cortex packs lint` locally passes
   in CI.
6. **One index format, any host.** The app reads an `index.json` from a URL.
   Point it at the official one, a fork, or a company's own registry — a
   team marketplace is a setting, not a product.

---

## 3. The pack format (v1)

```
<id>/
├── manifest.yaml
├── README.md              # long description, shown on the pack's page (optional)
├── preview.png            # card image, ≤ 200 KB (optional)
├── templates/*.md         # → <vault>/templates/ — except templates/<name>.md, the row
│                          #   template → <vault>/collections/<name>/_template-<name>.md
├── schemas/*.yaml         # → <vault>/.cortex/schemas/          (collection packs)
├── index.md               # → <vault>/collections/<name>/_index.md   (collection packs)
├── index/<c>.md           # → <vault>/collections/<c>/_index.md      (packs with several collections)
├── seed/*.md              # → <vault>/collections/<name>/            (collection packs)
└── seed/<c>/*.md          # → <vault>/collections/<c>/               (rows for an extra collection)
```

A pack may own several collections — the Habit Tracker installs `habits`
and its daily `habit-log` — by naming the extras in `collections:`. The
primary keeps the single-collection layout; each extra has its own
`schemas/<c>.yaml`, `index/<c>.md`, `templates/<c>.md` and `seed/<c>/`.
On install an extra's page gets `parent: <primary>` unless its `index/<c>.md`
sets `parent:` itself, so it nests under the primary in the sidebar the way
a child database sits inside a page; the rows never move on disk.

```yaml
# manifest.yaml
format: 1                       # manifest format version; the app refuses unknown majors
id: tasks                       # [a-z0-9-], unique across the index, equals the folder name
name: Tasks
version: 1.2.0                  # semver; must increase whenever any file changes
kind: collection                # note | collection | bundle (several packs installed together)
summary: A to-do database with board and calendar views.   # one line, ≤ 120 chars, no product names
description: |                  # a paragraph; Markdown allowed
  …
tags: [productivity, tasks, database]
author:
  name: Cortex team
  url: https://github.com/frontal-cortex
license: CC0-1.0                # SPDX id; CC0-1.0 or CC-BY-4.0 for official packs
credits: "Inspired by the task databases in Notion's gallery and the Obsidian Tasks plugin."
min_cortex: 0.3.0               # lowest app version whose schema/view features the pack needs
collection: tasks               # collection packs: the folder under collections/
collections: []                 # extra collections the pack owns, e.g. [habit-log]; usually omitted
files:                          # every file, so lint can catch strays and install knows what it wrote
  - templates/task.md
  - schemas/tasks.yaml
  - index.md
  - seed/example-task.md
```

Rules `lint` enforces:

- Only `.md`, `.yaml`, `.png`, `.jpg`, `.webp`, `.svg` files; only under the
  five known folders; no path with `..`, no absolute paths, no symlinks; total
  ≤ 2 MB, images ≤ 200 KB each.
- Every file listed in `files`, every listed file present, nothing unlisted.
- Frontmatter parses with placeholders quoted; only known placeholders
  (`{{date}}`, `{{time}}`, `{{title}}`, `{{uuid}}` in templates; `{{today}}`
  in seeds); schema property types are ones the app knows; every view in
  `index.md` references properties that exist in the schema; seed rows use
  only schema properties.
- No raw HTML in Markdown beyond a small allow-list (`<br>`, `<sub>`,
  `<sup>`, comments). Published sites render Markdown, so raw HTML is the one
  place a pack could carry something that runs in a browser.
- `id` matches the folder; `version` is valid semver and, in CI, greater than
  the version already in the index when any file changed.
- `summary` and `name` do not contain third-party product names (a word list,
  warning not error).

`kind: bundle` lists other pack ids in `includes:` and installs them in order
(e.g. "Second Brain starter" = PARA index + tasks + project tracker + weekly
review). Bundles own no files of their own.

---

## 4. The marketplace repository

`frontal-cortex/marketplace`, public, MIT for the tooling, each pack under
its own license field.

```
marketplace/
├── packs/<id>/…               # one folder per pack, any tier
├── index.json                 # generated; never edited by hand
├── featured.yaml              # hand-curated ordering for the app's front page
├── CONTRIBUTING.md            # how to submit; the review checklist
├── CODEOWNERS                 # who reviews what
├── LICENSE
└── .github/workflows/
    ├── lint.yml               # cortex packs lint on every PR (blocks merge)
    ├── index.yml              # regenerate index.json on merge to main, commit it
    └── release.yml            # on tag: publish index.json + packs to GitHub Pages (a static CDN)
```

**Trust tiers**, recorded per pack in `index.json` and shown as a badge:

| Tier | Who | How it gets there | Shown |
|---|---|---|---|
| `official` | Cortex team | Written or adopted by maintainers; bundled in the app | by default, first |
| `verified` | Community | Passed lint **and** a maintainer reviewed the content (checklist below) | by default, with badge |
| `community` | Community | Passed lint; a maintainer merged after a sanity glance, no content review | by default, with badge; a setting hides the tier |

Tier is a field in `index.json` set by maintainers (a `tiers.yaml` map in
the repo, not the manifest — a contributor cannot promote themselves).

**Review checklist** (`CONTRIBUTING.md`, applied for `verified`):

- Does what the summary says, with a real vault, from a clean install.
- Templates open cleanly in the app; placeholders resolve; no empty
  headings that will never be filled.
- Database packs: views make sense, seed rows are obviously examples, the
  row template matches the schema.
- No personal data, no third-party trademarks in names, license set,
  credits given where a design is borrowed.
- Uninstall leaves nothing behind.

**`index.json`**, what the app consumes:

```json
{
  "format": 1,
  "generated": "2026-09-08T10:00:00Z",
  "base": "https://frontal-cortex.github.io/marketplace/packs/",
  "packs": [
    { "id": "tasks", "name": "Tasks", "version": "1.2.0", "kind": "collection",
      "tier": "official", "summary": "…", "tags": ["…"], "author": {"name": "…"},
      "license": "CC0-1.0", "min_cortex": "0.3.0", "preview": "tasks/preview.png",
      "files": ["templates/task.md", "…"],
      "sha256": { "templates/task.md": "…", "…": "…" },
      "commit": "a1b2c3…" }
  ]
}
```

Per-file hashes let the app verify what it downloaded and let `update`
tell modified files from untouched ones. `commit` pins the pack to the
revision the index was generated from, so what a user installs is exactly
what was reviewed.

**Hosting.** GitHub Pages from the release workflow: `index.json` and the
raw pack files at stable URLs, no server, cache-friendly. The `base` field
means the same index format works from any static host or a company's
internal one.

**Relationship to this repo.** The official packs *live* in the marketplace
repo. This repo vendors a snapshot for bundling: `tools/sync-packs.sh <tag>`
copies `packs/` for the official tier into `crates/cortex-core/packs/`,
`featured.yaml` and `tiers.yaml` beside it, and records the commit in
`crates/cortex-core/VERSION`; `MARKETPLACE_REPO=/path` syncs from a local
clone. The `marketplace/` directory drafted here became the new repo's first
commit on 2026-09-08. The repo's `tools/` are Python mirrors of the Rust
lint and index generator (byte-identical output, checked when both change),
so CI needs nothing but that repository.

---

## 5. Installation, updates, removal (core)

`cortex_core::marketplace`, used identically by the CLI, MCP and the app.

**Sources.** `Source::Bundled` (compiled-in official packs) and
`Source::Remote { index_url }`. `catalog(sources)` merges them: a remote
entry with a higher version wins over the bundled one; the bundled one is
the offline fallback. The remote index is cached in the app's data dir with
its `generated` timestamp; refreshed when the user opens the marketplace or
asks, never in the background.

**Install record**, `.cortex/packs.yaml` in the vault (committed, portable):

```yaml
- id: tasks
  version: 1.2.0
  tier: official
  source: bundled           # or the index URL
  installed: 2026-09-08
  files:
    - path: templates/task.md
      sha256: …             # of the file as installed, after placeholder substitution
    - path: .cortex/schemas/tasks.yaml
      sha256: …
    - path: collections/tasks/_index.md
      sha256: …
    - path: collections/tasks/example-task.md
      sha256: …
```

**`install(root, id, opts)`**

1. Resolve the pack (bundled or fetch the files named in the index, verify
   each `sha256`, refuse on mismatch).
2. Plan: map each pack file to its vault path; substitute `{{today}}` in
   seeds. Return the plan before writing if `dry_run` — the app shows "this
   will write these N files" first.
3. Conflicts: a destination that exists and is not in this pack's record →
   skip it and report, unless `force` (then overwrite, but only for
   `templates/` and `schemas/`; never a collection row). For a collection
   that already exists: **merge** the schema (add properties the schema
   lacks, never remove or retype), keep the existing `_index.md`, skip seeds.
4. Write files, write the record. Nothing is committed; auto-commit or the
   next sync carries it like any other change.

**`update(root, id)`** — for each recorded file whose on-disk hash still
equals the recorded hash, replace it with the new version; a file the user
edited is left alone and reported ("kept your version of
`templates/task.md`"). New files are added. Seeds are never re-added. The
record's version and hashes are rewritten.

**`remove(root, id)`** — delete recorded files whose hash is unchanged;
leave edited ones and say so; never touch collection rows other than the
recorded seeds; drop the record. A collection's folder is removed only if
it is then empty.

**`lint(dir)`** — section 3's rules; returns a list of findings with
severity, used by the CLI, CI, and the `packs new` scaffold.

**`export(root, what)`** — the contributor's on-ramp: turn a template file
or an existing collection (schema + `_index.md` + optionally its rows as
seeds, personal data stripped by hand) into a pack directory with a
generated manifest. Most good community templates start life as someone's
own working setup.

---

## 6. Surfaces

**CLI**

```
cortex packs list [--tier official|verified|community] [--installed] [--json]
cortex packs show <id>              # manifest, files, what would be written
cortex packs install <id> [--force] [--dry-run]
cortex packs update [<id>]          # all installed, or one; reports kept edits
cortex packs remove <id>
cortex packs lint [<dir>]           # a pack dir, or every pack under packs/
cortex packs new <id> [--from templates/x.md | --from collections/y]   # export, then lint
cortex packs index                  # regenerate index.json (used by CI)
cortex packs refresh                # re-fetch the remote index
```

**MCP** — `list_packs`, `install_pack`, `update_pack`, `remove_pack`. An
agent told "set up a habit tracker" can install one; every result is a
file the user sees immediately, and the record makes it undoable.

**App** — a full-window Marketplace page (the Settings shell: nav left,
content right):

- Nav: All, Installed, then by kind and tag; a search box; a tier filter.
- Cards: preview image or a rendered excerpt of the template / the table's
  columns and views; name, summary, tier badge, author, version; Install →
  Installed, or Update when the index has a newer version.
- Pack page: full description, the file list ("what this installs"), the
  license and credits, a link to the source in the marketplace repo,
  Install / Update / Remove with the conflict report shown before writing.
- Entry points: command palette *Browse templates…*, the Templates section
  header, the Getting-started card's "Try a template" step, and a
  "Get more" row at the bottom of New from template.

**Settings → Templates** (keys in `settings.yaml`, so a company can set them
in a shared vault):

| Key | Meaning |
|---|---|
| `marketplace_url` | Index URL. Empty = the official one. A company points this at its own registry. |
| `marketplace_tiers` | Tiers shown: `official, verified, community` (default all three). |
| `marketplace_extra` | Additional index URLs, merged (a team registry alongside the official one). |

---

## 7. Community flow, end to end

1. **Make it.** Build the template in your own vault until it works.
2. **Export.** `cortex packs new my-pack --from collections/reading` writes
   `my-pack/` with a manifest; edit `summary`, `description`, `tags`, strip
   personal data from seeds, add a `preview.png` (a screenshot of the table
   or note).
3. **Lint.** `cortex packs lint my-pack` until clean.
4. **Submit.** Fork `frontal-cortex/marketplace`, add `packs/my-pack/`, open
   a PR. CI runs lint and posts the rendered preview as a PR comment.
5. **Review.** A maintainer merges → `community` tier. If they also run the
   checklist and it passes → `verified`. Either way the index regenerates
   on merge and the app sees it on its next refresh.
6. **Update.** Bump `version`, PR again. CI refuses a changed pack with an
   unchanged version. Users see Update in the app; nothing changes until
   they click.
7. **Takedown.** Maintainers can remove or demote a pack; the app's cached
   index stops listing it, installed copies stay (they are the user's files).

Governance in `CONTRIBUTING.md`: code of conduct, license requirement (CC0
or CC-BY for content), no trademarks in names, personal-data rule, a
response-time expectation for reviews, and how `verified` is granted and
revoked.

---

## 8. Sequencing

| Phase | Work | Effort | Depends on |
|---|---|---|---|
| 0 Content | Apply section 1: views + row templates for database packs, Tasks in, Reading List as a database, habit model, quoted placeholders, `{{today}}`, credits field, manifest v1 fields | ½–1 day | — |
| 1 Core | `marketplace` module: bundled catalog, install (plan / conflicts / merge), record, update, remove, lint; tests; `cortex packs`; MCP tools; docs — **done** (`crates/cortex-core/src/marketplace.rs`; the remote source, cache and settings of phase 4 came along with it, pending only the Pages index) | 2 days | 0 |
| 2 App | Marketplace page, pack page, palette / Templates / Getting-started entry points, Installed / Update states, Settings → Templates — **done** (`src/components/Shell/MarketplaceView.tsx`; `mod+shift+b`, *Browse templates…* in the palette, the Templates section's sparkle and "Get more templates" row, the Getting-started "Try a template" step, Settings → Templates) | 2 days | 1 |
| 3 Repo | Create `frontal-cortex/marketplace`, move packs, lint + index + release workflows, Pages hosting, CONTRIBUTING, tiers file, `tools/sync-packs.sh` — **done** except Pages, which needs the repo public (see the status note at the top) | 1 day | 1 |
| 4 Remote | Remote source with cache, hash verification, `refresh`, `marketplace_url` / `_extra` / `_tiers` settings, Update flow end to end — **done** (verified against a locally served index; the hosted one follows Pages) | 1 day | 2, 3 |
| 5 Community | `packs new` / export, PR preview comment in CI, first external submission walked through, second batch of official packs — **done** (`lint.yml` posts the preview and refuses a changed pack without a version bump; CONTRIBUTING walks a submission through; Decision Log, Contacts, Goals, Content Calendar) | 1–2 days | 4 |

Phases 0, 1, and 3 need no UI and are good backlog rows for the overnight
orchestrator. Phase 2 wants the same design pass as the Settings page.

Backlog after this: install counts and ratings (need the hosted service),
paid packs, packs that also carry a theme or keybindings, localized packs.

---

## 9. Decisions to confirm

- The swaps: Tasks replaces Recipe Box in the top ten; Book Notes becomes a
  Reading List database; the habit model becomes one row per habit-week.
- Three tiers as named, all shown by default with badges, a setting to hide
  `community`.
- The marketplace is its own repo; this repo vendors a snapshot for
  bundling. (Alternative: a git submodule — simpler to sync, worse for
  contributors and CI.)
- GitHub Pages as the CDN; no server until the hosted service exists.
- `.cortex/packs.yaml` is committed with the vault, so a teammate cloning
  it sees the same Installed state and can update.
- Licenses: CC0-1.0 or CC-BY-4.0 required for content; contributors keep
  copyright.

## 10. Trust model: what a pack can and cannot do

A pack is data. It cannot carry code, and the app never executes anything a
pack contains. The controls, in the order they apply:

**Format.** Lint (run on the user's machine before install, not only in CI)
allows only `md`, `yaml`, `png`, `jpg`, `webp`, `svg`; rejects any path with
`..` or an absolute component; caps a pack at 2 MB; refuses raw HTML beyond
`<br>`, `<sub>`, `<sup>` and comments. Install refuses a pack with lint errors.

**Integrity.** Every file's SHA-256 is checked against the index before it is
written. A mirror or proxy cannot substitute a file. This proves the files
match the index, not that the index is honest — see *Sources*.

**Interpretation.** Formulas, filters, view specs and placeholders are parsed
into small ASTs and interpreted; there is no `eval`, no shell. Markdown is
converted to editor blocks, never rendered as HTML. The window carries a
Content-Security-Policy (`script-src 'self'`, no objects, frames only over
`https`) and a navigation guard, so even a future rendering bug has no path
to the IPC layer — which matters because the app can open a real terminal.
The only frames are web-embed blocks: the guard admits the player URLs
`cortex-core`'s embed table derives (YouTube, Vimeo, CodePen, Figma, Maps)
and hosts the reader loaded through an embed's click-to-load shield.

**Links and images.** A link in a note or a README opens outside the app only
if it is `http`, `https` or `mailto`; `file:` and custom schemes are refused.
A remote image in a row loads only when the reader clicks it, so opening a
view sends nothing anywhere. Preview images are loaded only from the official
index. Asset paths are resolved inside the vault; a `cover:` cannot read
`../../.ssh/id_rsa`.

**Overwrites.** Install never replaces a file it does not own unless the user
ticks Force, and never adds seeds to an existing collection. A pack cannot
silently replace your Tasks schema by choosing the same collection name.

**Provenance.** Every page and row a pack writes carries `pack: <id>` in its
frontmatter — visible in the file, in `git log`, and to an agent reading the
vault. The MCP server's instructions say that vault content, pack-installed
content included, is the user's data and never instructions to the agent.

**Prompt injection.** The one attack a data-only format still allows is prose
addressed to the agent rather than the reader ("ignore previous instructions",
"run `curl … | sh`"). Lint warns on text that reads that way, in both the Rust
and the Python lint, and the review checklist for `verified` requires a
maintainer to read every seed and body with that in mind. It is a warning, not
an error: legitimate packs mention `cortex set` and shell commands.

**Sources.** Packs from an index the user added in Settings carry a
"Third-party index" badge, their preview images are not loaded, and the
Settings hint says what the hash check does and does not prove. Ids of the
bundled packs are reserved; the contributing guide's name policy forbids
imitating another pack's name or hero.

**Not covered.** Signing (an index compromise at the source still passes the
hash check); anything the user pastes into the terminal themselves; the
content of packs installed before this section existed (they have no `pack:`
key until reinstalled).
