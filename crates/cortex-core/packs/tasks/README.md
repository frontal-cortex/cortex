# Tasks

One row per task, the views a to-do app ships, and a page per task with a
"done when" line and a checklist. The views follow the date: nothing to tick
in the morning, nothing to untick at night.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/tasks.yaml` | `.cortex/schemas/tasks.yaml` | status, priority, due, days_left, completed, repeat, area, project |
| `index.md` | `collections/tasks/_index.md` | views: Today, This week, Upcoming, Inbox, Board, Done per week |
| `templates/tasks.md` | `collections/tasks/_template-tasks.md` | New row's shape: frontmatter plus Done when / Steps / Notes |
| `seed/*.md` | `collections/tasks/` | six tasks, one per view: overdue, inbox, this week (repeating), upcoming, and two done — today and last week |

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install tasks`).
2. **Open Tasks** in the sidebar and press New row. Type the title and stop
   — that is capture. The task is in Inbox.
3. **Plan** when you have a minute: give each task a `due` date. Today,
   This week and Upcoming sort themselves out from that one field.

When a task is finished, set `status` to `done`. `completed` gets today's
date on its own, and that date is what Done per week counts.

## The properties

| Property | Type | What it means |
|---|---|---|
| `status` | status | `todo` → `doing` → `done`; `waiting` for things blocked on someone else; `someday` to park a task without deleting it |
| `priority` | select | `p1` (red) first, then `p2`, `p3`; views sort by it in that order |
| `due` | date | when it must be finished; the three dated views are cut from it |
| `days_left` | formula | `days_until(due)`: negative when overdue; computed, never written to the file |
| `completed` | date | stamped with today when `status` becomes `done` and the cell is empty; feeds the chart |
| `repeat` | text | empty, or `daily`, `weekly`, `biweekly`, `monthly`, `quarterly`, `yearly`, `every 3 days` — see below |
| `area` | select | work, personal, home, health, learning, admin |
| `project` | text | the project's name; filter on it, and the Project Tracker pack matches and counts it |

## The views

| View | Answers | How |
|---|---|---|
| Today | what am I doing now, and what slipped? | `due <= @today`, not done or parked; p1 first, then oldest due |
| This week | what is left before Sunday? | `due > @today and due <= @sunday`, soonest first |
| Upcoming | what is coming after this week? | `due > @sunday`, soonest first |
| Inbox | what have I captured but not planned? | todo with no due date; newest first |
| Board | where is everything? | grouped by status; drag between columns |
| Done per week | am I finishing things? | count of `completed` dates, bucketed by week |

The three dated views partition every open, dated task: a row is in exactly
one of them, and moves from Upcoming to This week to Today as the calendar
does. An undated task is in none of them (an empty date is never "before
today"), which is what makes Inbox work.

Every view is a few lines of YAML in `collections/tasks/_index.md`; add a
filter, change a sort, or add a view of your own from the view menu.

## Repeating tasks

Put `repeat: weekly` on a task (the seed "Do the weekly review" has it). When
you set its `status` to `done`, the row stays as it is — history, with its
`completed` date — and a new row is written with every date moved forward
one interval and `status` back to `todo`. `daily`, `biweekly`, `monthly`,
`quarterly`, `yearly` and `every N days|weeks|months` work the same way. It
fires whether you finish the task in the app, with `cortex set`, or through
an agent; there is no timer and nothing to copy.

## Ideas

- **A month grid**: add a calendar view with `date: due` from the view menu
  if you would rather see deadlines on a month than in a list.
- **Projects**: install the Project Tracker pack. Its project page embeds a
  board of the tasks whose `project` is that project's name, and its Open
  view shows how many of them are still open — no linking beyond typing the
  same name.
- **A daily note that shows today's tasks**: put this in your daily template
  and the day's list is at the top of every day:

  ```cortex-view
  source: collections/tasks
  type: table
  columns: [title, priority, due, days_left]
  filter: due <= @today and status != 'done' and status != 'someday'
  sort: [priority asc]
  ```

- **Sub-tasks**: the Steps checklist in a task's body is usually enough. For
  a task that grows into several tasks, make it a project instead.
- **Waiting-for review**: add a view with `filter: status == 'waiting'`
  sorted by `created` and look at it once a week.
- **Done by area**: add `series: area` to the Done per week chart to see
  whether what you finish is work or life.
- **Terminal and agents**: `cortex set collections/tasks/write-the-project-brief
  status=done` finishes a task; `completed` is stamped and a repeating task
  comes back. The schema is plain YAML, so an agent can read it and add rows
  with the right fields.

## Upgrading from 2.0

Version 2.0 had a `today` checkbox; 2.1 drops it, because `due <= @today`
does the job without a morning ritual. Rows that still carry `today: true`
are harmless; set their `due` to today to see them in Today. Rows that were
`done` with an empty `completed` stay empty — the auto-stamp fires on the
edit that finishes a task, not on old rows. `repeat` and `days_left` are
new; existing rows need nothing.

## Upgrading from 1.x

Version 1 had `status` (todo / doing / done), `priority` (low / medium /
high), `due` and `project`. Those names are unchanged, so old rows still
work. Old priority values are not renamed — search for `priority: high` and
change it to `p1` so it sorts with the rest.
