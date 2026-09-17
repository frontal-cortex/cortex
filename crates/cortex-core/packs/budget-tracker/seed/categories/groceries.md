---
title: Groceries
type: note
tags: []
icon: 🥦
monthly_budget: 400
bucket: need
active: true
created: "{{today}}"
---

## What counts

Supermarket, market, the corner shop. Takeaway and restaurants are Dining.
The two seeded weekly shops count here, so the ring has a value on the day
you install.

## Spent per month

```cortex-view
source: collections/expenses
type: chart
chartType: bar
x: date
bucket: month
y: amount
agg: sum
filter: category == @this and date >= @month-11
```

## Latest expenses

```cortex-view
source: collections/expenses
type: table
columns: [title, date, amount, account, payee]
sort: [date desc]
limit: 15
filter: category == @this
```
