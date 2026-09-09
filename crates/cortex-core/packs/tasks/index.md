---
created: "{{today}}"
icon: ✅
tags: []
title: Tasks
type: database
views:
- name: Today
  type: table
  columns: [title, priority, due, days_left, project, status]
  filter: due <= @today and status != 'done' and status != 'someday'
  sort: [priority asc, due asc]
- name: This week
  type: table
  columns: [title, priority, due, days_left, project, status]
  filter: due > @today and due <= @sunday and status != 'done' and status != 'someday'
  sort: [due asc, priority asc]
- name: Upcoming
  type: table
  columns: [title, due, days_left, priority, project, status]
  filter: due > @sunday and status != 'done' and status != 'someday'
  sort: [due asc, priority asc]
- name: Inbox
  type: table
  columns: [title, priority, area, project, created]
  filter: status == 'todo' and due == ''
  sort: [created desc]
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
date and, if it comes back, a `repeat`. `area` says which part of life it
belongs to; `project` is the project's name as free text, which is enough to
filter on and for the Project Tracker pack to count.

Capture with New row and stop there — the task sits in **Inbox** until it has
a due date. When you plan, give it one. **Today** is every task due today or
earlier that is not done: the day's list, with what slipped at the top of
it, and `days_left` says by how much. **This week** is what is due between
tomorrow and Sunday; **Upcoming** is everything after that. The three views
are the same rule applied to today's date, so the lists move on their own
overnight.

When a task is finished, set `status` to `done`. `completed` is stamped with
today's date by itself, and **Done per week** counts those dates, one bar
per week. The **Board** is every row grouped by status.

Set a task to `waiting` when it is blocked on someone else, and to `someday`
to park it without deleting it — parked tasks leave the dated views but stay
on the board. A task with `repeat: weekly` (or `daily`, `monthly`, `every 3
days`) comes back when it is done: the finished row stays as history and a
new one appears with `due` moved forward.
