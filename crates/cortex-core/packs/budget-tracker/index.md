---
created: "{{today}}"
icon: 💸
tags: []
title: Budget
type: database
views:
- name: Ledger
  type: table
  columns: [title, date, amount, kind, category, account, payee, bill]
  sort: [date desc]
- name: This month
  type: table
  columns: [title, date, amount, category, account, payee]
  filter: kind == 'expense' and date >= @month
  sort: [date desc]
- name: This month by category
  type: chart
  chartType: bar
  x: category
  y: amount
  agg: sum
  filter: kind == 'expense' and date >= @month
- name: By category
  type: board
  group: category
  filter: kind == 'expense'
- name: Month by month
  type: chart
  chartType: bar
  x: date
  bucket: month
  y: amount
  agg: sum
  series: kind
  filter: kind != 'transfer'
- name: Categories over time
  type: chart
  chartType: line
  x: date
  bucket: month
  y: amount
  agg: sum
  series: category
  filter: kind == 'expense'
- name: Calendar
  type: calendar
  date: date
---

One row per transaction: what it was, the date, the amount (always positive —
`kind` says whether it was spent, earned or moved between your own accounts),
a category and the account it hit. Log a purchase with New row, or from a
terminal with `cortex set`; nothing else needs updating, because every number
on this page and on the limits and bills pages is computed from the rows each
time you open it.

Start by logging the last week or so from your bank statement. The Ledger is
the raw list, newest first. This month is only the current month's spending
(`date >= @month`, so it rolls over by itself on the 1st), and This month by
category is the same rows as one bar per category — the two pages to open
before a big purchase. By category is your spending as columns you can drag a
row between when it was filed wrong. Month by month puts income and spending
side by side per month; Categories over time draws one line per category so
you can see which one is creeping up. The calendar shows paydays and the days
the bills land.

The two databases nested under this one give the ledger its meaning:
`budget-limits` holds the amount you mean to spend per category each month and
shows, per limit, what this month's ledger rows add up to, what is left and
how much of the limit is used; `budget-bills` is every recurring charge with
its cycle and next due date, which moves forward on its own when you tick
`paid`. Link a transaction to its bill with the `bill` property and the bill
knows when it was last paid and what it has cost in total.
