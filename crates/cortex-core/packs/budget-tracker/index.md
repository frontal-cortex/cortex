---
created: "{{today}}"
icon: 💸
tags: []
title: Budget
type: database
width: full
views:
- name: Ledger
  type: table
  columns: [title, date, amount, kind, category, account, to_account, payee, bill]
  sort: [date desc]
  summary: {amount: sum}
- name: This month
  type: table
  columns: [title, date, amount, category, account, payee]
  filter: kind == 'expense' and date >= @month
  sort: [date desc]
  summary: {amount: sum}
- name: By month
  type: list
  columns: [title, category, amount, account]
  filter: kind == 'expense'
  sort: [date desc]
  group: date
  bucket: month
  summary: {amount: sum}
- name: Summary
  type: stats
  stats:
    - {label: Spent, agg: sum, field: amount, filter: "kind == 'expense' and date >= @month", format: currency}
    - {label: Earned, agg: sum, field: amount, filter: "kind == 'income' and date >= @month", format: currency}
    - {label: Net, expr: "Earned - Spent", format: currency}
    - {label: Transactions, agg: count, filter: "date >= @month"}
- name: This month by category
  type: chart
  chartType: donut
  x: category
  y: amount
  agg: sum
  labels: name_value
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

::: columns 1 2 1

## Quick add

```cortex-button
label: New expense
action: add-row
collection: budget
values: {kind: expense, date: "{{today}}"}
open: true
```

```cortex-button
label: New income
action: add-row
collection: budget
values: {kind: income, category: income, date: "{{today}}"}
open: true
```

```cortex-button
label: New transfer
action: add-row
collection: budget
values: {kind: transfer, category: savings, date: "{{today}}"}
open: true
```

## Budgets

```cortex-view
source: collections/budget-limits
type: gallery
layout: compact
size: small
columns: [title, spent, monthly_limit, used]
filter: active == true
sort: [used desc]
```

:::

## This month

```cortex-view
source: collections/budget
type: stats
stats:
  - {label: Spent, source: collections/budget, agg: sum, field: amount, filter: "kind == 'expense' and date >= @month", format: currency}
  - {label: Earned, source: collections/budget, agg: sum, field: amount, filter: "kind == 'income' and date >= @month", format: currency}
  - {label: Net, expr: "Earned - Spent", format: currency}
  - {label: Transactions, source: collections/budget, agg: count, filter: "date >= @month"}
```

## Spending

```cortex-view
source: collections/budget
type: list
columns: [title, category, amount, account]
filter: kind == 'expense'
sort: [date desc]
group: date
bucket: month
summary: {amount: sum}
limit: 40
```

## Income

```cortex-view
source: collections/budget
type: list
columns: [title, category, amount, account]
filter: kind == 'income'
sort: [date desc]
group: date
bucket: month
summary: {amount: sum}
limit: 20
```

:::

## Where it went

```cortex-view
source: collections/budget
type: chart
chartType: donut
x: category
y: amount
agg: sum
labels: name_value
legend: false
height: medium
filter: kind == 'expense' and date >= @month
```

## Accounts

```cortex-view
source: collections/accounts
type: gallery
layout: compact
size: small
columns: [title, balance, kind]
filter: active == true
```

## Transfers

```cortex-view
source: collections/budget
type: list
columns: [title, account, to_account, amount]
filter: kind == 'transfer'
sort: [date desc]
limit: 10
```

::: end

```cortex-views
collection: budget
```

One row per transaction: what it was, the date, the amount (always positive
— `kind` says whether it was spent, earned or moved between your own
accounts), a category and the account it hit; a transfer names both
accounts. Log with the buttons above, with New row in any view, or from a
terminal with `cortex set`. Nothing else needs updating: every number on
this page and on the accounts, limits and bills pages is computed from the
rows each time you open it.

The views below the dashboard are the raw lists. The Ledger is everything,
newest first, with a total; This month is the current month's spending
(`date >= @month`, so it rolls over on the 1st); By month folds spending
into one section per month with a total each; the donut and the bar chart
are the same rows as pictures; By category is a board you can drag a row
across when it was filed wrong; the calendar shows paydays and the days the
bills land.

Three databases nest under this one: `accounts` (opening balance in, live
balance out), `budget-limits` (the monthly amount per category, with spent,
remaining and the ring) and `budget-bills` (recurring charges that advance
themselves when you tick `paid`; link a payment with the `bill` property and
the bill knows when it was last paid and what it has cost).
