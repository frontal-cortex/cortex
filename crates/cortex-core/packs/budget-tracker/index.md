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
  - {label: Saved, expr: "if(earned > 0, net / earned * 100, 0)", format: percent}
  - {label: Last month, source: collections/expenses, agg: sum, field: amount, filter: "date >= @month-1 and date < @month", hidden: true}
  - {label: vs last month, expr: "if(last_month > 0, (spent - last_month) / last_month * 100, 0)", format: percent}
  - {label: Net worth, source: collections/accounts, agg: sum, field: balance, filter: "active == true", format: currency}
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

```cortex-view
source: collections/categories
type: gallery
layout: compact
size: small
columns: [title, spent, monthly_budget, usage]
filter: active == true and monthly_budget > 0
sort: [usage desc]
limit: 6
```

## Due soon

```cortex-view
source: collections/budget-bills
type: list
columns: [title, amount, next_due]
filter: paid == false and next_due <= @today+21
sort: [next_due]
limit: 5
```

## Saving for

```cortex-view
source: collections/budget-wishlist
type: list
columns: [title, price, saved]
filter: status != 'bought'
sort: [saved desc]
limit: 3
```

:::

## Month by month

```cortex-view
source: collections/expenses
type: chart
chartType: bar
x: date
y: amount
agg: sum
bucket: month
filter: date >= @month-5
height: small
legend: false
```

## Biggest this month

```cortex-view
source: collections/expenses
type: table
columns: [title, amount, category, date]
filter: date >= @month
sort: [amount desc]
limit: 5
```

## Latest

```cortex-view
source: collections/expenses
type: list
columns: [title, category, amount]
sort: [date desc]
limit: 8
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
limit: 6
labels: name
legend: false
height: medium
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
sort: [balance desc]
```

## Where it came from

```cortex-view
source: collections/income
type: chart
chartType: donut
x: source
y: amount
agg: sum
limit: 5
labels: name
legend: false
height: small
filter: date >= @month
```

::: end

The page answers the month's questions and stops there: what went out and
came in, whether that is more or less than last month, what the biggest
budgets and payments were, what is due, and what every account holds.
Everything is worked out from your rows each time you look, so there is
nothing to recalculate and nothing to reset on the first of the month.

Log with the three buttons: an expense, an income, or a transfer between your
own accounts. Each opens a new row dated today; fill in the amount and pick
the account, and for an expense the category.

The databases themselves are in the sidebar, under this page: **Expenses**,
**Income** and **Transfers** hold what you log, with every row and the Weekly,
Monthly, Chart and Calendar views over them; **Accounts** and **Categories**
add it up; **Bills and subscriptions** and **Wishlist** keep the recurring
charges and the things you are saving towards.
