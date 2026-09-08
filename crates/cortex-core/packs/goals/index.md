---
created: "{{today}}"
icon: 🎯
tags: []
title: Goals
type: database
views:
- name: Board
  type: board
  group: status
- name: Active
  type: table
  columns: [title, area, timeframe, priority, progress, target, measure]
  filter: status != 'done' and status != 'dropped'
  sort: [target]
- name: By area
  type: board
  group: area
  filter: status != 'done' and status != 'dropped'
- name: Target dates
  type: calendar
  date: target
- name: Achieved
  type: table
  columns: [title, area, start, target, measure]
  filter: status == 'done'
  sort: [target desc]
---

One row per goal: a real outcome with a date on it, not a task. Each has the
area of life it serves, a timeframe (year, quarter, month), a priority, a
target date, a `progress` number from 0 to 100 and a one-line `measure` — how
you will know it is done. `status` carries flow and health in one column:
planned, on track, at risk, off track, done, dropped. The Board is the page to
open on a Monday; the yellow and red columns are the conversation to have with
yourself.

Start with three goals, not twelve. New row gives each its own page with a
Why, a Done means, its milestones, its progress chart and room for the plan
and the obstacles. On that page, New row under Milestones creates a step
already linked to the goal; two or three per goal is plenty. Milestones and
Check-ins sit under Goals in the sidebar.

Progress is a log, not a number you overwrite. Once a week, open each active
goal and press New row under Progress, picking the `goal-checkins` template:
that gives a check-in with the goal and today's date filled in, where you set
`progress` and `confidence` and write what moved. The chart below draws one
line per goal from those rows, one point per week; copy the latest number
into the goal's `progress` so the Active table sorts by it. Achieved keeps
everything you finished, with start and target dates: the list to read in
December.

## Progress over time

```cortex-view
source: collections/goal-checkins
type: chart
chartType: line
x: date
y: progress
bucket: week
agg: max
series: goal
```
