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
The two seeded weekly shops count here, so `spent` and `used` have a value
on the day you install.

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
