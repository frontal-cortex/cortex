---
created: "{{today}}"
icon: 📈
tags: []
title: Check-ins
type: database
views:
- name: Log
  type: table
  columns: [title, goal, date, progress, confidence]
  sort: [date desc]
- name: Progress
  type: chart
  chartType: line
  x: date
  y: progress
  bucket: week
  agg: max
  series: goal
- name: Calendar
  type: calendar
  date: date
---

One short row per review of one goal: the date, `progress` from 0 to 100,
your `confidence` that it will land, and a few lines in the body about what
moved since last time and what is in the way. Two minutes per goal, once a
week. The easiest way to add one is from the goal's own page: New row under
Progress, from the `goal-checkins` template, fills in the goal and the date.
Because every check-in is kept, progress becomes a line you can look back
along instead of a number you overwrite: a goal stuck at 40 for six weeks is
visible here long before its target date.

The Progress chart draws one line per goal, one point per week (the highest
number logged that week, so two check-ins in one week do not fight). Each
goal's page shows the same chart filtered to itself. The Calendar shows the
weeks you skipped. The goal's own `progress` and `last_checkin` columns are
read from these rows, so there is nothing to copy across.
