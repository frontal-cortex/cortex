---
created: "{{today}}"
icon: 💸
tags: []
title: Budget
type: database
width: full
---

```cortex-view
source: collections/expenses
type: stats
stats:
  - {label: Spent, source: collections/expenses, agg: sum, field: amount, filter: "date >= @month", format: currency}
  - {label: Earned, source: collections/income, agg: sum, field: amount, filter: "date >= @month", format: currency}
  - {label: Net, expr: "Earned - Spent", format: currency}
```

::: columns 1 2 1

## Quick actions

```cortex-button
label: New expense
action: add-row
collection: expenses
values: {date: "{{today}}"}
open: true
```

```cortex-button
label: New income
action: add-row
collection: income
values: {date: "{{today}}"}
open: true
```

```cortex-button
label: New transfer
action: add-row
collection: transfers
values: {date: "{{today}}"}
open: true
```

## Budgets

```cortex-views
collection: categories
```

:::

## Expenses

```cortex-views
collection: expenses
```

## Income

```cortex-views
collection: income
```

## Transfers

```cortex-views
collection: transfers
```

:::

## Where it went

```cortex-view
source: collections/expenses
type: chart
chartType: donut
x: category
y: amount
agg: sum
labels: name
legend: false
height: medium
filter: date >= @month
```

## Where it came from

```cortex-view
source: collections/income
type: chart
chartType: donut
x: source
y: amount
agg: sum
labels: name_value
legend: false
height: small
filter: date >= @month
```

## Accounts

```cortex-view
source: collections/accounts
type: gallery
layout: compact
size: small
columns: [title, balance]
filter: active == true
```

::: end

Log what happens with the three buttons: an expense, an income, or a transfer
between your own accounts. Each opens a new row dated today; fill in the
amount and pick the account, and for an expense the category. Everything else
on this page is computed from those rows each time you look — the budget
rings, the charts, every account's balance — so there is nothing to
recalculate and nothing to reset on the first of the month.

Under this page sit the databases: **Expenses**, **Income** and **Transfers**
hold what you log; **Accounts** and **Categories** add it up; **Bills and
subscriptions** and **Wishlist** keep the recurring charges and the things you
are saving towards.
