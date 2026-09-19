---
created: "{{today}}"
icon: 📋
tags: []
title: Workouts
type: database
views:
- name: Recent
  type: table
  columns: [title, date, day, sets_done, volume, top_set, duration, feel]
  sort: [date desc]
  limit: 30
  summary: {volume: sum, sets_done: sum}
- name: This week
  type: table
  columns: [title, date, day, sets_done, volume, top_set]
  filter: date >= @monday
  sort: [date desc]
- name: By day
  type: board
  group: day
  columns: [title, date, volume, sets_done]
  sort: [date desc]
- name: Calendar
  type: calendar
  date: date
- name: Volume per week
  type: chart
  chartType: bar
  x: date
  y: volume
  agg: sum
  bucket: week
  filter: date >= @today-180
---

One row per session. The day tells the split apart — push, pull or legs — and
everything else is its sets added up: how many, how much they came to, the
heaviest one, and how many were taken to an eight or above.

Open a session to log it: the table on its page adds sets that already belong
to it, so a set is a movement, a weight and some reps.

A session with no sets logged is a session that did not happen — delete it and
the week's numbers close over it.
