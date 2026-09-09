---
created: "{{today}}"
icon: 🎯
tags: []
title: Projects
type: database
views:
- name: Board
  type: board
  group: status
  filter: status != 'done' and status != 'dropped'
- name: Due soon
  type: table
  columns: [title, area, priority, deadline, days_left]
  filter: deadline <= @today+14 and status != 'done' and status != 'dropped'
  sort: [deadline]
- name: Timeline
  type: timeline
  start: start
  end: deadline
  filter: status != 'dropped'
- name: All
  type: table
  columns: [title, area, status, priority, start, deadline, days_left, completed]
  sort: [priority desc, deadline]
- name: Deadlines
  type: calendar
  date: deadline
- name: Finished per month
  type: chart
  chartType: bar
  x: completed
  bucket: month
  agg: count
  filter: status == 'done'
- name: Archive
  type: table
  columns: [title, area, status, completed, outcome]
  filter: status == 'done' or status == 'dropped'
  sort: [completed desc]
---

A project is a short effort with a defined outcome and a deadline — if you
cannot say what "done" looks like, it is an area, not a project. Every project
names the area it serves, so each area's page shows its projects without you
doing anything.

Work from the Board: `planned` is the backlog, `active` is what you are doing
now (keep it under five), `on hold` is waiting on something. Due soon is the
same open projects with a deadline inside two weeks — or already past —
with `days_left` counting down (negative means late). The Timeline draws each
project as a bar from `start` to `deadline`, so you can see where they pile
up; a planned project with no start yet is a dot on its deadline.

Two dates fill themselves in. `start` is stamped the day you first set a
project `active`, and `completed` the day you set it `done`. If you abandon
one, set `dropped`. Done or dropped, it leaves the Board and appears in the
Archive, and the month chart counts how many you actually finish.

A project's page holds its outcome, a next-actions checklist, the resources
linked to it and a running log. Write the retrospective there when you close
it; that is what you will want in a year.
