---
created: "{{today}}"
icon: ✅
tags: []
title: Tasks
type: database
views:
- name: Today
  type: table
  columns: [title, priority, due, project, status]
  filter: today == true and status != 'done'
  sort: [priority asc, due asc]
- name: Inbox
  type: table
  columns: [title, priority, area, project, created]
  filter: status == 'todo' and due == '' and today != true
  sort: [created desc]
- name: Upcoming
  type: table
  columns: [title, due, priority, project, status]
  filter: due != '' and status != 'done' and status != 'someday'
  sort: [due asc, priority asc]
- name: Board
  type: board
  group: status
- name: Done per week
  type: chart
  chartType: bar
  x: completed
  y: title
  agg: count
  bucket: week
  filter: status == 'done' and completed != ''
---

One row per task. A task has a `status`, a `priority` (p1 first), a `due`
date, and a `today` checkbox for the handful you are working from right now.
`area` says which part of life it belongs to; `project` is the project's name
as free text, which is enough to filter on.

Capture with New row and stop there — the task sits in **Inbox** until it has
a due date or a `today` tick. When you plan, do one of those two things. When
it is finished, set `status` to `done` and put the date in `completed`;
**Done per week** counts those dates, one bar per week. **Upcoming** is every
dated task soonest first, so anything overdue is at the top; the **Board** is
the same rows grouped by status.

Set a task to `waiting` when it is blocked on someone else, and to `someday`
to park it without deleting it — parked tasks leave Inbox and Upcoming but
stay on the board. Untick `today` at the end of the day, or leave it ticked
and let tomorrow's list start where today's ended.
