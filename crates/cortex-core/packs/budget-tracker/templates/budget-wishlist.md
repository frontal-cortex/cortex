---
title: "{{title}}"
type: note
tags: []
price: 0
priority: want
category: shopping
url:
target:
active: true
created: "{{date}}"
---

<!-- Set `price` and `priority`; the rest is computed. Putting money aside: log a transfer in the ledger with `wish` set to this row and it counts towards `put_by` and the bar. Buying it: log the expense with `wish` set to this row and it moves to Bought at what it really cost. -->

## Why

What it is for and what would happen if you did not buy it. The honest
answer here is what makes a wishlist different from a shopping cart.

## Money put aside

Transfers tagged with this wish, newest first.

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, account, to_account]
sort: [date desc]
filter: wish == '{{title}}' and kind == 'transfer'
summary: {amount: sum}
```

## What it cost

Empty until you buy it; then the real number, next to the `price` you
guessed above.

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, category, account, payee]
sort: [date desc]
filter: wish == '{{title}}' and kind == 'expense'
summary: {amount: sum}
```

## Before buying

- [ ] Would I still want it in a month?
- [ ] Is there a second-hand or cheaper version?
- [ ] Does it fit this month's budget without touching the limits?
