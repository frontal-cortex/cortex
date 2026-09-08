---
created: "{{today}}"
icon: 🗂️
tags: []
title: Projects
type: database
views:
- name: Open
  type: table
  columns: [title, status, priority, area, deadline, progress, next_action]
  filter: status != 'done' and status != 'dropped'
  sort: [priority asc, deadline asc]
- name: Board
  type: board
  group: status
- name: Deadlines
  type: calendar
  date: deadline
- name: Stalled
  type: table
  columns: [title, priority, area, deadline, progress]
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
`deadline`, a `progress` percentage you update when you review it, and one
`next_action`: the next physical thing to do. Its page states the outcome,
lists its milestones and, if the Tasks pack is installed, shows a board of
the tasks that name it.

Start with New row: a title, a status, a deadline if there is one, and a
next action. That is a project. **Open** is the list you look at most —
everything not done or dropped, p1 first, soonest deadline next. **Board**
is the same rows by status; **Deadlines** puts them on a calendar.

**Stalled** is the one to check each week: active projects whose
`next_action` is empty. A project with nothing to do next is either finished
or stuck, and either way it needs a decision. **Finished per month** counts
`completed` dates, one bar per month, so you can see whether things close.
Milestones live in `collections/milestones/`, one row per dated step, with
their own calendar across all projects; New row under a project's Milestones
heading fills in `project` for you.
