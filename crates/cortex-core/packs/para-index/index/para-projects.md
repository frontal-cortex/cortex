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
- name: All
  type: table
  columns: [title, area, status, priority, deadline, completed]
  sort: [deadline]
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
now (keep it under five), `on hold` is waiting on something. When a project
finishes, set `status: done` and `completed` to today; if you abandon it, set
`dropped`. Either way it leaves the Board and appears in the Archive, and the
month chart shows how many you actually finish.

A project's page holds its outcome, a next-actions checklist, the resources
linked to it and a running log. Write the retrospective there when you close
it; that is what you will want in a year.
