---
title: "{{title}}"
type: note
tags: []
monthly_budget: 0
bucket: need
active: true
created: "{{date}}"
---

<!-- Set `monthly_budget`. `spent`, `remaining` and the ring are computed from the expenses filed under this category. -->

```cortex-view
source: collections/categories
type: stats
stats:
  - {label: Spent this month, source: collections/expenses, agg: sum, field: amount, filter: "category == @this and date >= @month", format: currency}
  - {label: Budget, source: collections/categories, agg: sum, field: monthly_budget, filter: "title == @this", format: currency}
  - {label: Left, expr: "budget - spent_this_month", format: currency}
  - {label: Last month, source: collections/expenses, agg: sum, field: amount, filter: "category == @this and date >= @month-1 and date < @month", format: currency}
  - {label: Payments, source: collections/expenses, agg: count, filter: "category == @this and date >= @month"}
```

## What counts

What goes in this category and what does not, so future you files things the
same way.

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
