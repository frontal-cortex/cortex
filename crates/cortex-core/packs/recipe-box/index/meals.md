---
created: "{{today}}"
icon: 📅
tags: []
title: Meals
type: database
views:
- name: Plan
  type: calendar
  date: date
- name: Today
  type: table
  columns: [title, slot, recipe, cooked]
  filter: "date == @today"
  sort: [slot]
- name: This week
  type: table
  columns: [title, date, slot, recipe, cooked]
  filter: "date >= @monday and date <= @sunday"
  sort: [date, slot]
- name: By slot
  type: board
  group: slot
  filter: "date >= @monday and date <= @sunday"
- name: Cooked per week
  type: chart
  chartType: bar
  x: date
  y: title
  agg: count
  bucket: week
  series: slot
  filter: "cooked == true"
---

One row per planned meal: a date, a slot (breakfast, lunch, dinner, snack) and
the recipe it points at. The Plan calendar is the month; Today is what is on
for today, breakfast first; This week is Monday to Sunday in order, and By
slot is the same week as a board, so the week's lunches sit in one column.
Tick `cooked` after the meal: it stays where it is with the box ticked, counts
in the Cooked per week chart (one series per slot), and updates the recipe's
`times_cooked` and `last_cooked`. The body is room for how it went — that row
also shows up in the recipe's cook log.
