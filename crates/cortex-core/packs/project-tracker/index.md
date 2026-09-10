---
created: "{{today}}"
icon: 🗂️
tags: []
title: Projects
type: database
width: full
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

::: columns 1 2 1

## Quick add

```cortex-button
label: New project
action: add-row
collection: projects
values: {status: active, priority: p2, start: "{{today}}"}
open: true
```

```cortex-button
label: New milestone
action: add-row
collection: milestones
values: {date: "{{today+7}}"}
open: true
```

## At a glance

```cortex-view
source: collections/projects
type: stats
stats:
  - {label: Active, source: collections/projects, agg: count, filter: "status == 'active'"}
  - {label: Due in 30 days, source: collections/projects, agg: count, filter: "deadline <= @today+30 and status != 'done' and status != 'dropped'"}
  - {label: Milestones this month, source: collections/milestones, agg: count, filter: "date >= @month and date < @month+1"}
  - {label: Finished this year, source: collections/projects, agg: count, filter: "status == 'done' and completed >= @year"}
```

:::

## Open

```cortex-view
source: collections/projects
type: table
columns: [title, priority, deadline, days_left, progress, next_action]
filter: status != 'done' and status != 'dropped'
sort: [priority asc, deadline asc]
limit: 15
```

## Milestones by week

```cortex-view
source: collections/milestones
type: list
columns: [title, project, date]
filter: done != true and date >= @today-7
sort: [date asc]
group: date
bucket: week
limit: 30
```

:::

## Open by area

```cortex-view
source: collections/projects
type: chart
chartType: donut
x: area
y: title
agg: count
labels: name_value
legend: false
height: medium
filter: status != 'done' and status != 'dropped'
```

## Stalled

```cortex-view
source: collections/projects
type: list
columns: [title, priority, deadline]
filter: status == 'active' and next_action == ''
sort: [priority asc]
limit: 10
```

::: end

```cortex-views
collection: projects
```

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
