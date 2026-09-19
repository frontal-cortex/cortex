---
created: "{{today}}"
icon: 🔁
tags: []
title: Sets
type: database
views:
- name: Recent
  type: table
  columns: [title, date, exercise, weight, reps, rpe, volume, e1rm, kind]
  sort: [date desc]
  limit: 50
- name: This week
  type: table
  columns: [title, date, exercise, weight, reps, rpe, volume]
  filter: date >= @monday and kind != warmup
  sort: [date desc]
  summary: {volume: sum, reps: sum}
- name: Per week
  type: chart
  chartType: bar
  x: date
  y: volume
  agg: sum
  bucket: week
  filter: kind != warmup and date >= @today-180
- name: By muscle
  type: chart
  chartType: bar
  x: muscle
  y: volume
  agg: sum
  filter: kind != warmup and date >= @month-2
- name: Heaviest
  type: table
  columns: [title, date, exercise, weight, reps, e1rm]
  filter: kind != warmup
  sort: [weight desc]
  limit: 25
---

One row per set: the movement, the weight, the reps, and how hard it felt if
you want to say. Volume is weight × reps; the one-rep-max estimate is Epley,
weight × (1 + reps ÷ 30), and stops above twelve reps where it stops being
true. The muscle and the day are read from the exercise, so a chart can group
by either without you typing them here.

`kind: warmup` keeps a set out of the totals, the records and the charts —
log warmups if you like the record, and they will never flatter a number.
