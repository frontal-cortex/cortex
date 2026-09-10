---
title: "{{title}}"
type: note
tags: []
kind: current
initial: 0
active: true
created: "{{date}}"
---

<!-- Set `initial` to the balance on the day you start logging. The title is what ledger rows name in `account` / `to_account`; keep it short (checking, savings, cash). -->

## Recent movements

Everything that touched this account, newest first — spending and income
where it is the `account`, transfers where it is either end.

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, kind, category, to_account]
sort: [date desc]
limit: 20
filter: account == '{{title}}' or to_account == '{{title}}'
```

## Month by month

```cortex-view
source: collections/budget
type: chart
chartType: bar
x: date
bucket: month
y: amount
agg: sum
series: kind
filter: account == '{{title}}'
```
