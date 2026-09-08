---
title: "{{title}}"
type: note
tags: []
amount: 0
cycle: monthly
next_due: "{{date}}"
category: subscriptions
account: checking
active: true
url:
created: "{{date}}"
---

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
