---
created: "{{today}}"
icon: 🍽️
tags: []
title: Food log
type: database
views:
- name: Today
  type: table
  columns: [meal, food, servings, calories, protein, carbs, fat, fibre]
  filter: date == @today
  sort: [created]
  summary: {calories: sum, protein: sum, carbs: sum, fat: sum, fibre: sum}
- name: This week
  type: table
  columns: [date, meal, food, servings, calories, protein, fibre]
  filter: date >= @monday
  sort: [date desc, created desc]
  summary: {calories: sum, protein: sum, fibre: sum}
- name: By meal
  type: board
  group: meal
  columns: [title, date, servings, calories, protein]
  filter: date >= @today-6
- name: Calories per day
  type: chart
  chartType: bar
  x: date
  y: calories
  agg: sum
  bucket: day
  filter: date >= @today-29
- name: Protein per day
  type: chart
  chartType: bar
  x: date
  y: protein
  agg: sum
  bucket: day
  filter: date >= @today-29
- name: Everything
  type: table
  columns: [date, meal, food, servings, calories, protein, carbs, fat, fibre]
  sort: [date desc, created desc]
  limit: 200
---

One row per thing you ate: the food, how many servings of it, and which meal
it was. Nothing else is typed — the calories and the macros are the food's own
numbers multiplied by the servings, worked out when you look at them, so
correcting a food corrects every meal you ever logged it in.

`servings: 1` is one serving as that food defines it. If the food is written
per 100 g, then 150 g is `1.5`; half a portion is `0.5`.
