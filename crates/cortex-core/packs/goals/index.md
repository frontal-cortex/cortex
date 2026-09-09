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
  columns: [title, area, priority, progress, milestones_done, next_milestone, target, days_left]
  filter: status != 'done' and status != 'dropped'
  sort: [priority, target]
- name: Due for review
  type: table
  columns: [title, priority, status, last_checkin, progress, next_milestone]
  filter: last_checkin < @today-7 or last_checkin == '' and status != 'done' and status != 'dropped'
  sort: [last_checkin]
- name: By area
  type: board
  group: area
  filter: status != 'done' and status != 'dropped'
- name: Timeline
  type: timeline
  start: start
  end: target
  filter: status != 'done' and status != 'dropped'
- name: Achieved
  type: table
  columns: [title, area, start, completed, measure]
  filter: status == 'done'
  sort: [completed desc]
---

One row per goal: a real outcome with a date on it, not a task. Each has the
area of life it serves, a timeframe (year, quarter, month), a priority, a
`start` and a `target` date and a one-line `measure` — how you will know it
is done. `status` carries flow and health in one column: planned, on track,
at risk, off track, done, dropped. The Board is the page to open on a Monday;
the yellow and red columns are the conversation to have with yourself.

The rest of the columns are worked out from the milestones and check-ins that
point at the goal, every time you open the page. `progress` is the highest
number any check-in has logged, shown as a bar; `last_checkin` is the date of
the newest one. `milestones_done` is the share of the goal's milestones that
are done and `next_milestone` the earliest open one's date. `days_left` counts
down to `target`. `completed` is stamped with the day you set `status` to
done.

Start with three goals, not twelve. New row gives each its own page with a
Why, a Done means, its milestones, its progress chart and room for the plan
and the obstacles. On that page, New row under Milestones creates a step
already linked to the goal; two or three per goal is plenty. Milestones and
Check-ins sit under Goals in the sidebar.

Active is the open goals, highest priority first and nearest target within
that. Due for review is the open goals with no check-in in the last seven
days — the weekly list, which empties as you work through it. Once a week,
open each goal on it and press New row under Progress, picking the
`goal-checkins` template: that gives a check-in with the goal and today's
date filled in, where you set `progress` and `confidence` and write what
moved. The chart below draws one line per goal from those rows, one point per
week. The Timeline lays every open goal out as a bar from start to target,
with today marked. Achieved keeps everything you finished, newest first by
the day it was done: the list to read in December.

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
