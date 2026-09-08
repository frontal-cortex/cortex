---
title: "{{title}}"
type: note
tags: []
monthly_limit: 0
bucket: need
active: true
created: "{{date}}"
---

<!-- The title must match a `category` option in the ledger exactly (lowercase, e.g. groceries) — the views below filter on it. -->

## What counts

What goes in this category and what does not, so future you files things the
same way.

## Spent per month

One bar per month. Compare the current month's bar with `monthly_limit`
above: that is the budget check.

```cortex-view
source: collections/budget
type: chart
chartType: bar
x: date
bucket: month
y: amount
agg: sum
filter: category == '{{title}}' and kind == 'expense'
```

## Latest transactions

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, account, payee]
sort: [date desc]
limit: 15
filter: category == '{{title}}' and kind == 'expense'
```
