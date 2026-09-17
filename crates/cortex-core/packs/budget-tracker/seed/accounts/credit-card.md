---
title: Credit card
type: note
tags: []
icon: 💳
kind: credit
initial: 0
active: true
created: "{{today}}"
---

A card you spend on and pay off. A charge takes its balance below zero and a
payment from Checking — a transfer — brings it back up, so what you owe on the
card shows as a negative balance. The seeded music subscription went on the
card and was paid off two days later, which leaves it at zero.

## Spending on this card

```cortex-view
source: collections/expenses
type: table
columns: [title, date, amount, category]
sort: [date desc]
limit: 15
filter: account == @this
```

## Payments to the card

```cortex-view
source: collections/transfers
type: table
columns: [title, date, amount, from_account]
sort: [date desc]
limit: 15
filter: to_account == @this
```
