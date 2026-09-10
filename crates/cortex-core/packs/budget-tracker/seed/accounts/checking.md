---
title: checking
type: note
tags: []
icon: 🏦
kind: current
initial: 1200
active: true
created: "{{today}}"
---

The everyday account: salary lands here, rent and the weekly shop leave
from here. The opening balance is an example — replace it with what your
account held on the day you started logging.

## Recent movements

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, kind, category, to_account]
sort: [date desc]
limit: 20
filter: account == 'checking' or to_account == 'checking'
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
filter: account == 'checking'
```
