# Tasks

One row per task, the views a to-do app ships, and a page per task with a
"done when" line and a checklist.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/tasks.yaml` | `.cortex/schemas/tasks.yaml` | status, priority, today, due, completed, area, project |
| `index.md` | `collections/tasks/_index.md` | views: Today, Inbox, Upcoming, Board, Done per week |
| `templates/tasks.md` | `collections/tasks/_template-tasks.md` | New row's shape: frontmatter plus Done when / Steps / Notes |
| `seed/*.md` | `collections/tasks/` | three tasks that show the shape: one for today, one in the inbox, one done |

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install tasks`).
2. **Open Tasks** in the sidebar and press New row. Type the title and stop
   — that is capture. The task is in Inbox.
3. **Plan** when you have a minute: tick `today` for the ones you will do
   now and give the rest a `due` date. The Today view is your working list;
   Upcoming is everything with a date, soonest first.

When a task is finished, set `status` to `done` and the date in `completed`.
That date is what the Done per week chart counts.

## The properties

| Property | Type | What it means |
|---|---|---|
| `status` | status | `todo` → `doing` → `done`; `waiting` for things blocked on someone else; `someday` to park a task without deleting it |
| `priority` | select | `p1` (red) first, then `p2`, `p3`; views sort by it, so p1 always tops the list |
| `today` | checkbox | the short list you are working from; the Today view is exactly the ticked rows that are not done |
| `due` | date | when it must be finished; Upcoming sorts by it |
| `completed` | date | when you finished; feeds the chart |
| `area` | select | work, personal, home, health, learning, admin |
| `project` | text | the project's name; filter on it, and the Project Tracker pack matches it |

## The views

| View | Answers | How |
|---|---|---|
| Today | what am I doing now? | `today == true and status != 'done'`, p1 first, then by due |
| Inbox | what have I captured but not planned? | todo, no due date, not ticked today; newest first |
| Upcoming | what is coming, in order? | anything with a due date that is not done or parked, soonest first — overdue sits at the top |
| Board | where is everything? | grouped by status; drag between columns |
| Done per week | am I finishing things? | count of `completed` dates, bucketed by week |

Every view is a few lines of YAML in `collections/tasks/_index.md`; add a
filter, change a sort, or add a view of your own from the view menu.

## Ideas

- **A month grid**: add a calendar view with `date: due` from the view menu
  if you would rather see deadlines on a month than in a list.
- **Projects**: install the Project Tracker pack. Its project page embeds a
  board of the tasks whose `project` is that project's name — no linking to
  do beyond typing the same name.
- **A daily note that shows today's tasks**: put this in your daily template
  and the Today list is at the top of every day:

  ```cortex-view
  source: collections/tasks
  type: table
  columns: [title, priority, due]
  filter: today == true and status != 'done'
  sort: [priority asc]
  ```

- **Sub-tasks**: the Steps checklist in a task's body is usually enough. For
  a task that grows into several tasks, make it a project instead.
- **Waiting-for review**: add a view with `filter: status == 'waiting'`
  sorted by `created` and look at it once a week.
- **Terminal and agents**: `cortex set collections/tasks/write-the-project-brief
  status=done completed=2026-09-08` finishes a task. The schema is plain YAML, so an
  agent can read it and add rows with the right fields.

## Upgrading from 1.x

Version 1 had `status` (todo / doing / done), `priority` (low / medium /
high), `due` and `project`. Version 2 keeps those names, so existing rows
still work. Old priority values are not renamed — search for
`priority: high` and change it to `p1` if you want the sort to be right —
and old `done` rows have no `completed` date until you add one.
