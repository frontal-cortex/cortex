---
created: "{{today}}"
icon: 💪
tags: []
title: Exercises
type: database
views:
- name: By day
  type: board
  group: day
  columns: [title, muscle, best_weight, last_done]
  filter: active == true
- name: Records
  type: table
  columns: [title, day, muscle, best_e1rm, best_weight, sets_done, last_done]
  filter: active == true
  sort: [best_e1rm desc]
- name: Overdue
  type: table
  columns: [title, day, muscle, days_since, best_weight]
  filter: active == true and (days_since >= 10 or last_done is_empty)
  sort: [days_since desc]
- name: Catalogue
  type: table
  columns: [title, day, muscle, equipment, target_reps, rest, active]
  sort: [day, muscle]
- name: Volume, 30 days
  type: chart
  chartType: bar
  x: title
  y: volume_30d
  agg: sum
  filter: volume_30d > 0
---

One row per movement you do, filed under the day it belongs to and the muscle
it trains. Set `target_reps` and `rest` if you like a plan to follow; nothing
else here is typed.

The rest is read from your sets: how many you have done, the heaviest, the
best one-rep-max estimate, the last day you trained it and the volume of the
last thirty days. Open one to see its whole history — that is the page to look
at before a session, to know what to beat.

Untick `active` for a movement you have stopped doing: it leaves the board and
the records, and its history stays.
