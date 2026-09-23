---
created: "{{today}}"
icon: 🥑
tags: []
title: Foods
type: database
views:
- name: Most eaten
  type: table
  columns: [title, serving, calories, protein, carbs, fat, fibre, times_logged, last_eaten]
  sort: [times_logged desc]
- name: Favourites
  type: table
  columns: [title, serving, calories, protein, fibre, last_eaten]
  filter: favourite == true
  sort: [title]
- name: By kind
  type: board
  group: kind
  columns: [title, serving, calories, protein]
- name: Protein per serving
  type: chart
  chartType: bar
  x: title
  y: protein
  agg: max
  filter: protein > 0
  limit: 12
- name: Catalogue
  type: table
  columns: [title, kind, serving, calories, protein, carbs, fat, fibre, favourite]
  sort: [kind, title]
---

Your own food list. Each row is one food with the macros of **one serving** —
whatever you decide a serving is: 100 g, a slice, a scoop, a tin. Write the
numbers once and logging that food is only ever a number of servings.

Copy them off the packet, where they are already per 100 g or per portion.
For a meal you eat the same way every week — your usual breakfast, the same
lunchbox — make a food of the whole thing, `kind: meal`, with the totals of
the bowl: one row to log instead of five.

`times_logged` and `last_eaten` are read from the log, so this list sorts
itself by what you actually eat rather than what you once meant to.
