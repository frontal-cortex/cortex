---
created: "{{today}}"
icon: 🎯
tags: []
title: Categories
type: database
views:
- name: This month
  type: gallery
  layout: compact
  size: small
  columns: [title, spent, monthly_budget, usage]
  filter: active == true
  sort: [usage desc]
- name: Last month
  type: gallery
  layout: compact
  size: small
  columns: [title, last_month, monthly_budget, last_month_usage]
  filter: active == true
  sort: [last_month_usage desc]
- name: Budget check
  type: table
  columns: [title, bucket, monthly_budget, spent, remaining, usage, last_month]
  filter: active == true
  sort: [usage desc]
  summary: {monthly_budget: sum, spent: sum}
- name: Needs, wants, savings
  type: board
  group: bucket
  filter: active == true
---

One row per category you file expenses under, with what you mean to spend in
it each month. `spent` adds up this month's expenses in the category,
`remaining` is what is left of the budget, and `usage` is the share gone as a
ring. The same numbers for the previous month sit beside them, so a category
that ran over two months running stands out.

This month and Last month are the cards on the dashboard. Budget check is the
same numbers as a table, fullest first. `bucket` sorts categories into needs,
wants and savings for the 50/30/20 split; the board shows them that way.

Rename a category and the expenses filed under it follow. Leave
`monthly_budget` empty for a category you only want to see, and untick
`active` to keep a category's history without it on the dashboard.
