---
title: Checking
type: note
tags: []
icon: 🏦
kind: current
initial: 1200
active: true
created: "{{today}}"
---

The everyday account: salary lands here, rent and the weekly shop leave from
here, and it funds the savings and the credit card. The opening balance is an
example — replace it with what your account held on the day you started
logging.

## Spending from this account

```cortex-view
source: collections/expenses
type: table
columns: [title, date, amount, category]
sort: [date desc]
limit: 15
filter: account == @this
```

## Income into this account

```cortex-view
source: collections/income
type: table
columns: [title, date, amount, source]
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
