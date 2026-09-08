# PARA Index

Projects, Areas and Resources as three linked databases, an index note that
reads them live, and an archive that is a status rather than a place.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/para-areas.yaml` | `.cortex/schemas/para-areas.yaml` | category, status, standard, review, next_review |
| `schemas/para-projects.yaml` | `.cortex/schemas/para-projects.yaml` | status, area (relation), priority, outcome, deadline, completed |
| `schemas/para-resources.yaml` | `.cortex/schemas/para-resources.yaml` | kind, status, area and project (relations), url |
| `index.md` | `collections/para-areas/_index.md` | views: Areas, By category, Reviews (calendar), Archive — with the active projects embedded below |
| `index/para-projects.md` | `collections/para-projects/_index.md` | views: Board, All, Deadlines (calendar), Finished per month (chart), Archive |
| `index/para-resources.md` | `collections/para-resources/_index.md` | views: All, By kind, Inbox, Added per month (chart), Archive |
| `templates/para-areas.md` | `collections/para-areas/_template-para-areas.md` | New row for an area: standard, its own projects and resources, review log |
| `templates/para-projects.md` | `collections/para-projects/_template-para-projects.md` | New row for a project: outcome, next actions, its resources, log, retrospective |
| `templates/para-resources.md` | `collections/para-resources/_template-para-resources.md` | New row for a resource: why kept, key points, highlights |
| `templates/para-index.md` | `templates/para-index.md` | the "Second Brain" note: projects board, areas, recent resources, archive — all live |
| `seed/para-areas/*.md` | `collections/para-areas/` | Health, Finances, Career — starters to rename or delete |
| `seed/para-projects/*.md` | `collections/para-projects/` | Run a 10k (active), File the tax return (planned), Set up the home office (done) |
| `seed/para-resources/*.md` | `collections/para-resources/` | a training plan, the PARA article, a fund comparison in the inbox |

The folders are prefixed `para-` so they never collide with the `tasks` or
`project-tracker` packs, which own `collections/tasks/` and
`collections/projects/`. Projects and Resources nest under Areas in the
sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install para-index`).
2. **Rename the three areas** to yours, or add more with New row in Areas —
   three to six is right. Write each one's `standard` in a sentence and set
   `review` to how often you want to look at it.
3. **Add a project** under one of them: New row in Projects, fill in
   `outcome` and `deadline`, pick the `area`. It appears on that area's page
   at once. Then make a note from `para-index` (Templates in the sidebar) and
   pin it: that is your front page.

## How it works

- **Areas** are ongoing. Each has a `standard` (what good looks like), a
  `review` cadence and a `next_review` date; the Reviews calendar shows what
  is due. An area's page embeds two live tables — its open projects and its
  resources — filtered on the relation, so they fill in on their own.
- **Projects** end. `status` runs planned → active → done, with `on hold` and
  `dropped` on the side. The Board hides done and dropped; the Archive view
  shows only them; the chart counts how many you finish per month from the
  `completed` date. A project's page has its outcome, a next-actions
  checklist, the resources linked to it, a log and a retrospective.
- **Resources** are reference. New ones are `inbox`; filing means setting
  `active` and linking an `area` or `project`. The Inbox view is the one to
  empty each week.
- **Archive** is not a folder. Setting a status is enough, and because
  nothing moves, every relation and back-link keeps working. This is the one
  place the pack differs from PARA-as-folders on purpose.
- **Weekly review** lives at the bottom of the Second Brain note: empty the
  inbox, close finished projects, start the next one, push review dates
  forward. The `weekly-review` pack's checklist has a Projects line for the
  same pass.

## Ideas

- Tasks belong in the `tasks` pack; put the project's name in a task's
  `project` field and the two line up by name.
- Add a `person` property to Projects if you share the vault with a team.
- Filter the Second Brain note's Projects board to one area by adding
  `and area contains 'Health'` to its fence, and keep one such note per area.
- Meeting notes and decisions that belong to a project: link the project's
  page with `[[Run a 10k]]` and its back-links list them.

## Upgrading from 1.x

Version 1 was a single note template, `templates/para-index.md`, with four
headings and hand-written wiki links. Version 2 keeps that file name — the
note is now a live index of the three databases — so a note you already made
from the old template is untouched; make a new one from the updated template
when you are ready. Move each wiki link from the old note into a row: a
project into Projects, an area into Areas, a resource into Resources, and
anything under Archive into the same database with its archive status.
