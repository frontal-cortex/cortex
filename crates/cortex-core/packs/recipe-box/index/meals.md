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
- name: Upcoming
  type: table
  columns: [title, date, slot, recipe, cooked]
  filter: "cooked == false"
  sort: [date]
- name: By slot
  type: board
  group: slot
  filter: "cooked == false"
- name: Cooked per week
  type: chart
  chartType: bar
  x: date
  y: title
  agg: count
  bucket: week
  filter: "cooked == true"
---

One row per planned meal: a date, a slot (breakfast, lunch, dinner, snack) and
the recipe it points at. The Plan calendar is the week ahead; Upcoming is the
same list in order and By slot is it as a board, so the week's lunches sit in
one column; ticking `cooked` moves a meal off both and into the Cooked per
week chart. The body is room for how it went — that row also shows up in the
recipe's cook log.
