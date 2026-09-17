---
title: Cash
type: note
tags: []
icon: 👛
kind: cash
initial: 40
active: true
created: "{{today}}"
---

The money in your wallet. A cash withdrawal is a transfer from Checking into
here, and the coffee is an expense paid from here, so this balance goes up at
the machine and down at the counter.

## Spending from this account

```cortex-view
source: collections/expenses
type: table
columns: [title, date, amount, category]
sort: [date desc]
limit: 15
filter: account == @this
```

## Transfers

```cortex-view
source: collections/transfers
type: table
columns: [title, date, amount, from_account, to_account]
sort: [date desc]
limit: 15
filter: from_account == @this or to_account == @this
```
