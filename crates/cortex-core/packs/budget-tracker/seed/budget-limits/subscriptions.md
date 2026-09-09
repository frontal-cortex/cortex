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
limit is a monthly average. Nothing is logged against it yet, so `spent` is
empty and `remaining` is the whole limit.

## Spent per month

One bar per month; the current month's bar is the `spent` figure in the
table, and `monthly_limit` above is the line it should stay under.

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
