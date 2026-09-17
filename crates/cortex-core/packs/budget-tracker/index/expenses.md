---
created: "{{today}}"
icon: 📤
tags: []
title: Expenses
type: database
views:
- name: Recent
  type: table
  columns: [title, amount, category, account, date]
  sort: [date desc]
  limit: 25
- name: Weekly
  type: list
  columns: [title, category, amount, account]
  sort: [date desc]
  group: date
  bucket: week
  summary: {amount: sum}
- name: Monthly
  type: list
  columns: [title, category, amount, account]
  sort: [date desc]
  group: date
  bucket: month
  summary: {amount: sum}
- name: Chart
  type: chart
  chartType: bar
  x: date
  bucket: month
  y: amount
  agg: sum
  series: category
  stack: true
  filter: date >= @month-11
- name: By category
  type: board
  group: category
- name: Calendar
  type: calendar
  date: date
---

Money going out, one row per payment: what it was, the amount (always
positive), the category it counts against and the account it left. Being in
this database is what makes it spending — there is nothing to set to say so.

Recent is the latest payments. Weekly and Monthly fold them into one section
per week or month with a total each. Chart stacks the last twelve months by
category, so a month that ran high shows which category did it. By category
is a board: drag a row to another column when it was filed wrong, and the
category's budget ring moves with it.

Moving money between your own accounts — into savings, onto a credit card, out
of the cash machine — is not an expense. Log it in Transfers, and both
accounts' balances stay right.
