---
title: "{{title}}"
type: note
tags: []
amount: 0
repeat: monthly
repeat_mode: advance
next_due: "{{date}}"
paid: false
category: subscriptions
account: checking
active: true
url:
created: "{{date}}"
---

<!-- Tick `paid` when the charge goes out: `next_due` moves forward by `repeat` and `paid` clears, in this same row. Log the payment in the ledger with `bill` set to this row so Payments below and `last_paid` fill in. -->

## Details

What it covers, who it is with, how to cancel, and when the price last changed.

## Payments

Every ledger row whose `bill` points here, newest first.

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, account]
sort: [date desc]
filter: bill == '{{title}}'
```

## Review

- [ ] Still using it?
- [ ] Price still what it was?
- [ ] Cheaper plan or yearly option?
