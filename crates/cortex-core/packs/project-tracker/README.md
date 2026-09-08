# Project Tracker

One row per project, one row per milestone, and a page per project that shows
its outcome, its milestones and its tasks.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/projects.yaml` | `.cortex/schemas/projects.yaml` | status, priority, area, start, deadline, completed, progress, next_action |
| `schemas/milestones.yaml` | `.cortex/schemas/milestones.yaml` | `project` (a relation to the projects), `due`, `done` |
| `index.md` | `collections/projects/_index.md` | views: Open, Board, Deadlines, Stalled, Finished per month |
| `index/milestones.md` | `collections/milestones/_index.md` | views: Calendar, Upcoming, All |
| `templates/projects.md` | `collections/projects/_template-projects.md` | New row's shape: Outcome, Why now, live Milestones and Tasks, a Log |
| `templates/milestones.md` | `collections/milestones/_template-milestones.md` | New row's shape for a milestone |
| `seed/projects/*.md` | `collections/projects/` | three projects: one active with milestones, one stalled, one finished |
| `seed/milestones/*.md` | `collections/milestones/` | two milestones on the active project |

Milestones nest under Projects in the sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install project-tracker`).
2. **Open Projects** and press New row. Give it a title, set `status` to
   `active`, add a `deadline` if it has one, and write one `next_action` —
   the next physical thing you would do. That is enough.
3. **Open the project's page.** Fill in Outcome (what finished looks like).
   Press New row under its Milestones heading to add a dated step —
   `project` is filled in for you — and it appears there and on the
   Milestones calendar.

Once a week, go through **Open**: update `progress`, rewrite `next_action`,
and clear **Stalled**. When a project finishes, set `status: done` and the
date in `completed`.

## The properties

| Property | Type | What it means |
|---|---|---|
| `status` | status | `planned` → `active` → `done`; `on_hold` when you have chosen to pause it; `dropped` when you have chosen not to finish |
| `priority` | select | `p1` first, then `p2`, `p3`; Open sorts by it |
| `area` | select | work, personal, home, health, learning, side_project |
| `start` / `deadline` | date | when it began and when it must land; Deadlines is a calendar on `deadline` |
| `completed` | date | when it actually finished; compare with `deadline`, and it feeds the chart |
| `progress` | number | 0–100, set by you at review; there is no formula behind it, which keeps it honest |
| `next_action` | text | one concrete next step; empty on an active project means Stalled |

A milestone has `project` (the project it belongs to, picked from the
projects list), `due` and `done`.

## The views

| View | Answers | How |
|---|---|---|
| Open | what is live, in what order? | not done, not dropped; p1 first, then soonest deadline |
| Board | where is everything? | grouped by status; drag to move a project on |
| Deadlines | when does each land? | calendar on `deadline` |
| Stalled | which projects have nothing to do next? | `status == 'active' and next_action == ''` |
| Finished per month | do projects close? | count of `completed` dates, bucketed by month |
| Milestones → Calendar | what are the key dates across everything? | calendar on milestone `due` |
| Milestones → Upcoming | which milestones are still ahead? | not done, soonest first |

## How the project page works

The row template puts two live blocks on every project page. The first is a
table of milestones filtered to this project — it reads
`collections/milestones/` each time, so ticking a milestone there or here is
the same edit, and New row inside it sets `project` to this project. The
second is a board of tasks from the Tasks pack whose `project` text is this
project's title: install that pack, type the project's name in a task's
`project` field, and the task appears here. No link to maintain; if you do
not use the Tasks pack, delete that section from
`collections/projects/_template-projects.md`.

The Log at the bottom is a dated list you add to at each review — what moved,
what you decided. Over months it is the project's history.

## Ideas

- **Quarterly view**: add a table with `filter: deadline >= '2026-10-01' and
  deadline <= '2026-12-31'` to see what lands this quarter.
- **By area**: a board with `group: area` shows whether everything you are
  doing is work.
- **Weekly review note**: paste the Open view into your weekly template:

  ```cortex-view
  source: collections/projects
  type: table
  columns: [title, status, next_action, deadline]
  filter: status == 'active'
  sort: [priority asc]
  ```

- **Terminal and agents**: `cortex set collections/projects/website-relaunch
  next_action="Call the printer"` updates a project without opening it; the
  schema is plain YAML, so an agent can list stalled projects and ask you for
  a next action.

## Upgrading from 1.x

Version 1 had `status` (not_started / in_progress / blocked / done),
`priority` (low / medium / high), `deadline` and `next_action`. Version 2
keeps `deadline` and `next_action` unchanged and adds the rest. Old status
and priority values are not renamed: `not_started` → `planned`,
`in_progress` → `active`, `blocked` → `on_hold`, `high` → `p1`, `medium` →
`p2`, `low` → `p3` is a search-and-replace across `collections/projects/`.
