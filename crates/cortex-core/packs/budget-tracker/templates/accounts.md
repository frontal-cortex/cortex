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

```cortex-view
source: collections/accounts
type: stats
stats:
  - {label: Balance, source: collections/accounts, agg: sum, field: balance, filter: "title == @this", format: currency}
  - {label: Spent this month, source: collections/expenses, agg: sum, field: amount, filter: "account == @this and date >= @month", format: currency}
  - {label: In this month, source: collections/income, agg: sum, field: amount, filter: "account == @this and date >= @month", format: currency}
  - {label: Moved in, source: collections/transfers, agg: sum, field: amount, filter: "to_account == @this and date >= @month", format: currency}
  - {label: Moved out, source: collections/transfers, agg: sum, field: amount, filter: "from_account == @this and date >= @month", format: currency}
```

## Month by month

```cortex-view
source: collections/expenses
type: chart
chartType: bar
x: date
bucket: month
y: amount
agg: sum
height: small
legend: false
filter: account == @this and date >= @month-5
```

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
