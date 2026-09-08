# Cortex marketplace — template packs

A **pack** is a folder of Markdown and YAML that installs into a vault: note
templates, and for database packs a typed-property schema, the collection's
views, a row template, and a seed row or two. No code, no plugins, nothing
that runs — the same materials a vault is already made of, so every pack is
readable in a text editor and keeps working in any other Markdown tool.

This directory is the source of the **official** packs. It becomes the first
commit of `frontal-cortex/marketplace` (see `docs/marketplace.md`, section
4); the app bundles a snapshot of it. The installer (`cortex packs …`, the
Marketplace page) is phase 1 of that plan and does not exist yet — until it
does, a pack is installed by copying its files to the paths below.

## Layout

```
marketplace/
├── packs/<id>/            # one folder per pack
│   ├── manifest.yaml
│   ├── templates/*.md     # → <vault>/templates/
│   ├── schemas/*.yaml     # → <vault>/.cortex/schemas/<collection>.yaml    (collection packs)
│   ├── index.md           # → <vault>/collections/<collection>/_index.md   (collection packs: the views)
│   └── seed/*.md          # → <vault>/collections/<collection>/            (collection packs: example rows)
├── index.yaml             # GENERATED from the manifests by tools/gen_index.py — never edit by hand
├── featured.yaml          # hand-curated order for the front page (the top ten)
└── tiers.yaml             # trust tier per pack, set by maintainers: official | verified | community
```

## `manifest.yaml` (format 1)

```yaml
format: 1
id: tasks                        # [a-z0-9-], equals the folder name
name: "Tasks"
version: 1.0.0                   # semver; bump whenever any file changes
kind: collection                 # note | collection | bundle
summary: "One line, ≤ 120 characters, no product names."
description: |
  A paragraph. Markdown allowed.
tags: [productivity, tasks, database]
author:
  name: "Cortex team"
  url: https://github.com/frontal-cortex
license: CC0-1.0                 # SPDX id; CC0-1.0 or CC-BY-4.0 for content
credits: "Where the design comes from — attribution lives here, not in the summary."
min_cortex: 0.1.0                # lowest app version the pack's features need
collection: tasks                # collection packs only: the folder under collections/
files:                           # every file the pack ships, nothing else
  - templates/tasks.md
  - schemas/tasks.yaml
  - index.md
  - seed/example-task.md
```

## Rules (what `cortex packs lint` will enforce)

- Only `.md`, `.yaml`, `.png`, `.jpg`, `.webp`, `.svg`; only under the folders
  above; no `..`, no absolute paths, no symlinks; ≤ 2 MB per pack, ≤ 200 KB per image.
- `files` lists every file and every listed file exists.
- Frontmatter parses. **Placeholders are quoted** (`created: "{{date}}"`).
  Templates use `{{date}}`, `{{time}}`, `{{title}}`, `{{uuid}}` (expanded when a
  note is created from them); seeds and `index.md` use `{{today}}` (expanded
  once, at install).
- Schema property types are ones the app knows (`text`, `number`, `date`,
  `checkbox`, `select`, `multi_select`, `status`, `person`, `url`, `relation`);
  every `group:` / `date:` in `index.md` names a schema property; seed rows use
  only schema properties.
- No raw HTML beyond `<br>`, `<sub>`, `<sup>` and comments.
- `summary` and `name` carry no third-party product names (put them in `credits`).

## The packs

| Pack | Kind | Installs |
|---|---|---|
| daily-note | note | `templates/daily.md` |
| weekly-review | note | `templates/weekly-review.md` |
| meeting-notes | note | `templates/meeting.md` |
| one-on-one | note | `templates/one-on-one.md` |
| para-index | note | `templates/para-index.md` |
| tasks | collection | `collections/tasks/` (table, board by status, calendar on due) |
| project-tracker | collection | `collections/projects/` (table, board by status, calendar on deadline) |
| reading-list | collection | `collections/reading/` (table, board by status, gallery) |
| habit-tracker | collection | `collections/habits/` (one row per habit-week; table, calendar on week, board by habit) |
| budget-tracker | collection | `collections/budget/` (table, board by category, calendar on date) |
| recipe-box | collection | `collections/recipes/` (table, gallery, board by cuisine) |

The first ten are `featured.yaml`. Every pack is `official` and CC0.

## Regenerating the index

```bash
python3 marketplace/tools/gen_index.py
```
