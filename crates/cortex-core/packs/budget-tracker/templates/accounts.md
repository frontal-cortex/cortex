---
title: "{{title}}"
type: note
tags: []
kind: current
initial: 0
active: true
created: "{{date}}"
---

<!-- Set `initial` to what the account held on the day you start logging. Expenses, income and transfers pick this account by its title. -->

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
