---
title: dining
type: note
tags: []
icon: 🍜
monthly_limit: 150
bucket: want
active: true
created: "{{today}}"
---

## What counts

Restaurants, takeaway, coffee out, drinks. Anything you cooked is `groceries`.

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
filter: category == 'dining' and kind == 'expense'
```

## Latest transactions

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, account, payee]
sort: [date desc]
limit: 15
filter: category == 'dining' and kind == 'expense'
```
