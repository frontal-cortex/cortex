# Project Tracker

One row per project, one row per milestone, and a page per project that shows
its outcome, its milestones and its tasks. Progress, the next key date and
the days left are computed from those rows; you type the next action.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/projects.yaml` | `.cortex/schemas/projects.yaml` | status, priority, area, start, deadline, days_left, completed, progress, next_milestone, open_tasks, next_action |
| `schemas/milestones.yaml` | `.cortex/schemas/milestones.yaml` | `project` (a relation to the projects), `due`, `days_left`, `done` |
| `index.md` | `collections/projects/_index.md` | views: Open, Board, Timeline, Due in 30 days, Stalled, Finished per month |
| `index/milestones.md` | `collections/milestones/_index.md` | views: Calendar, Upcoming, All |
| `templates/projects.md` | `collections/projects/_template-projects.md` | New row's shape: Outcome, Why now, live Milestones and Tasks, a Log |
| `templates/milestones.md` | `collections/milestones/_template-milestones.md` | New row's shape for a milestone |
| `seed/projects/*.md` | `collections/projects/` | four projects: one active with milestones and a deadline, one stalled, two finished (last month and this) |
| `seed/milestones/*.md` | `collections/milestones/` | five milestones: three on the active project (one reached, two ahead), two reached on a finished one |

Milestones nest under Projects in the sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install project-tracker`).
2. **Open Projects** and press New row. Give it a title, set `status` to
   `active`, add a `deadline` if it has one, and write one `next_action` —
   the next physical thing you would do. That is enough.
3. **Open the project's page.** Fill in Outcome (what finished looks like).
   Press New row under its Milestones heading to add a dated step —
   `project` is filled in for you — and it appears there, on the Milestones
   calendar, and in the project's `progress` once you tick it.

Once a week, go through **Open**: rewrite `next_action`, tick the milestones
that were reached, and clear **Stalled**. When a project finishes, set
`status: done` — `completed` is stamped for you.

## The properties

| Property | Type | What it means |
|---|---|---|
| `status` | status | `planned` → `active` → `done`; `on_hold` when you have chosen to pause it; `dropped` when you have chosen not to finish |
| `priority` | select | `p1` first, then `p2`, `p3`; Open sorts by it in that order |
| `area` | select | work, personal, home, health, learning, side_project |
| `start` / `deadline` | date | when it began and when it must land; the Timeline is a bar from one to the other |
| `days_left` | formula | `days_until(deadline)`; negative once it has slipped |
| `completed` | date | stamped with today when `status` becomes `done` and the cell is empty; compare with `deadline`, and it feeds the chart |
| `progress` | rollup | the share of this project's milestones with `done` ticked, shown as a bar; empty when it has no milestones |
| `next_milestone` | rollup | the soonest `due` among its milestones not yet done |
| `open_tasks` | rollup | how many tasks in the Tasks pack name this project and are not done or parked; the column is absent when that pack is not installed |
| `next_action` | text | one concrete next step; empty on an active project means Stalled |

The computed columns are read from the milestone and task rows each time the
view is drawn; nothing is written back to the project's file, so the file
stays a short block of frontmatter you typed. Filters and sorts see them all
the same — `filter: progress < 50` works.

A milestone has `project` (the project it belongs to, picked from the
projects list), `due`, a computed `days_left` and `done`.

## The views

| View | Answers | How |
|---|---|---|
| Open | what is live, in what order, and how far along? | not done, not dropped; p1 first, then soonest deadline, undated last |
| Board | where is everything? | grouped by status; drag to move a project on |
| Timeline | what overlaps, and where is today? | a bar per project from `start` to `deadline`; a project with one date is a dot |
| Due in 30 days | what lands, or has slipped, within a month? | `deadline <= @today+30`, not done or dropped, soonest first |
| Stalled | which projects have nothing to do next? | `status == 'active' and next_action == ''` |
| Finished per month | do projects close? | count of `completed` dates, bucketed by month |
| Milestones → Calendar | what are the key dates across everything? | calendar on milestone `due` |
| Milestones → Upcoming | which milestones are still ahead, and how close? | not done, soonest first, with `days_left` |

## How the project page works

The row template puts two live blocks on every project page. The first is a
table of milestones filtered to this project — it reads
`collections/milestones/` each time, so ticking a milestone there or here is
the same edit, New row inside it sets `project` to this project, and the
project's `progress` moves. The second is a board of tasks from the Tasks
pack whose `project` text is this project's title: install that pack, type
the project's name in a task's `project` field, and the task appears here
and is counted in `open_tasks`. No link to maintain; if you do not use the
Tasks pack, delete that section from
`collections/projects/_template-projects.md` — the `open_tasks` column stays
out of the way on its own.

The Log at the bottom is a dated list you add to at each review — what moved,
what you decided. Over months it is the project's history.

## Ideas

- **This quarter**: a table with `filter: deadline >= @today and deadline <=
  @today+90` shows what lands in the next three months and keeps itself
  current; there is no fixed date to edit.
- **Behind**: `filter: status == 'active' and progress < 50 and days_left <
  14` finds projects with most of the work left and little time.
- **By area**: a board with `group: area` shows whether everything you are
  doing is work.
- **Weekly review note**: paste the Open view into your weekly template:

  ```cortex-view
  source: collections/projects
  type: table
  columns: [title, status, progress, next_milestone, next_action, days_left]
  filter: status == 'active'
  sort: [priority asc]
  ```

- **Terminal and agents**: `cortex set collections/projects/website-relaunch
  next_action="Call the printer"` updates a project without opening it; the
  schema is plain YAML, so an agent can list stalled projects and ask you for
  a next action. The computed columns (`progress`, `days_left`,
  `next_milestone`, `open_tasks`) are in the app's views and in the MCP
  `run_view` tool; `cortex view` in the terminal prints only the stored
  columns.

## Upgrading from 2.0

Version 2.0 had `progress` as a number you typed; 2.1 computes it from the
milestones instead. A `progress:` line left in an old project file is
ignored — delete it or not. `completed` now stamps itself when you set
`status: done`; rows already done keep whatever date they have. The
Deadlines calendar is replaced by the Timeline, which shows the same dates
as bars from `start`; the Milestones calendar still has every dated step.
`days_left`, `next_milestone` and `open_tasks` are new and need nothing from
you.

## Upgrading from 1.x

Version 1 had `status` (not_started / in_progress / blocked / done),
`priority` (low / medium / high), `deadline` and `next_action`. Those two
names are unchanged. Old status and priority values are not renamed:
`not_started` → `planned`, `in_progress` → `active`, `blocked` → `on_hold`,
`high` → `p1`, `medium` → `p2`, `low` → `p3` is a search-and-replace across
`collections/projects/`.
