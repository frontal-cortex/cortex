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
on this page is summed from the rows each time you open it.

Start by logging the last week or so from your bank statement. The Ledger is
the raw list, newest first. By category is your spending as columns you can
drag a row between when it was filed wrong. Month by month puts income and
spending side by side per month; Categories over time draws one line per
category so you can see which one is creeping up. The calendar shows paydays
and the days the bills land.

The two databases nested under this one give the ledger its meaning:
`budget-limits` holds the amount you mean to spend per category each month —
open a limit to see the spend against it — and `budget-bills` is every
recurring charge with its cycle and next due date. Link a transaction to its
bill with the `bill` property and the bill's page lists its payment history.
