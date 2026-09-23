---
created: "{{today}}"
icon: ⚖️
tags: []
title: Weigh-ins
type: database
views:
- name: Recent
  type: table
  columns: [date, weight, note]
  sort: [date desc]
  limit: 60
- name: Trend
  type: chart
  chartType: line
  x: date
  y: weight
  agg: avg
  bucket: week
  filter: date >= @today-180
- name: Every day
  type: chart
  chartType: line
  x: date
  y: weight
  agg: avg
  bucket: day
  filter: date >= @today-59
---

One row a day at most: the number, and anything about the morning that
explains it. Weigh the same way every time — after waking, after the
bathroom, before eating — or the noise between days will be larger than the
change you are looking for.

Read the weekly line, not the daily one. A day's weight moves with salt, sleep
and what is still in you; a week's average moves with what you ate.
