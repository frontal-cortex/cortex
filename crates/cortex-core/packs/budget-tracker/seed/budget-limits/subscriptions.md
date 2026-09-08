---
title: subscriptions
type: note
tags: []
icon: 🔁
monthly_limit: 60
bucket: want
active: true
created: "{{today}}"
---

## What counts

Streaming, software, memberships — anything in `budget-bills` filed under
`subscriptions`. A yearly charge lands as one tall month; that is fine, the
limit is a monthly average.

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
filter: category == 'subscriptions' and kind == 'expense'
```

## Latest transactions

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, account, payee]
sort: [date desc]
limit: 15
filter: category == 'subscriptions' and kind == 'expense'
```
