---
created: "{{today}}"
icon: 🗂️
tags: []
title: Projects
type: database
views:
- name: Open
  type: table
  columns: [title, status, priority, area, deadline, days_left, progress, next_milestone, open_tasks, next_action]
  filter: status != 'done' and status != 'dropped'
  sort: [priority asc, deadline asc]
- name: Board
  type: board
  group: status
- name: Timeline
  type: timeline
  start: start
  end: deadline
- name: Due in 30 days
  type: table
  columns: [title, priority, deadline, days_left, progress, next_milestone, next_action]
  filter: deadline <= @today+30 and status != 'done' and status != 'dropped'
  sort: [deadline asc]
- name: Stalled
  type: table
  columns: [title, priority, area, deadline, progress, next_milestone]
  filter: status == 'active' and next_action == ''
  sort: [priority asc]
- name: Finished per month
  type: chart
  chartType: bar
  x: completed
  y: title
  agg: count
  bucket: month
  filter: status == 'done' and completed != ''
---

One row per project — anything with an outcome and more than one step. A
project has a `status`, a `priority` (p1 first), an `area`, a `start` and a
`deadline`, and one `next_action`: the next physical thing to do. The rest
is computed from its milestones and shown, never typed: `progress` is the
share of its milestones ticked done, `next_milestone` is the soonest one
still open, `days_left` counts down to the deadline, and if the Tasks pack
is installed `open_tasks` is how many of its tasks are not done. Its page
states the outcome, lists its milestones and shows a board of those tasks.

Start with New row: a title, a status, a deadline if there is one, and a
next action. That is a project. **Open** is the list you look at most —
everything not done or dropped, p1 first, soonest deadline next; a project
with no deadline sorts last. **Board** is the same rows by status.
**Timeline** draws each project as a bar from `start` to `deadline` with
today marked, so overlap is visible; a project with only a start is a dot.
**Due in 30 days** is what lands (or has already slipped) within a month.

**Stalled** is the one to check each week: active projects whose
`next_action` is empty. A project with nothing to do next is either finished
or stuck, and either way it needs a decision. When one finishes, set
`status` to `done`: `completed` is stamped with today's date, and **Finished
per month** counts those dates, one bar per month, so you can see whether
things close. Milestones live in `collections/milestones/`, one row per
dated step, with their own calendar across all projects; New row under a
project's Milestones heading fills in `project` for you, and ticking one
moves that project's `progress`.
