---
title: groceries
type: note
tags: []
icon: 🥦
monthly_limit: 400
bucket: need
active: true
created: "{{today}}"
---

## What counts

Supermarket, market, the corner shop. Takeaway and restaurants are `dining`.

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
filter: category == 'groceries' and kind == 'expense'
```

## Latest transactions

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, account, payee]
sort: [date desc]
limit: 15
filter: category == 'groceries' and kind == 'expense'
```
