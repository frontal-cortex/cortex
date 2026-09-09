---
created: "{{today}}"
icon: 📖
tags: []
title: Reading log
type: database
views:
- name: Calendar
  type: calendar
  date: date
- name: Sittings
  type: table
  columns: [title, date, book, pages]
  sort: [date desc]
- name: Pages per week
  type: chart
  chartType: bar
  x: date
  y: pages
  agg: sum
  bucket: week
  series: book
---

One row per sitting: the `date`, the `book` it belongs to and the `pages`
you read. The body is for a line or two about the session if you want one.
The Reading list reads these rows to draw its week grid, each book's year
heatmap, its `logged` page count and its `last_read` date; Pages per week
here shows the pace, one colour per book. A day with no row is a day with no
reading — nothing needs resetting.
