---
title: Music streaming
type: note
tags: []
icon: 🎧
amount: 10.99
cycle: monthly
next_due: "{{today}}"
category: subscriptions
account: credit
active: true
url:
created: "{{today}}"
---

## Details

An example subscription. Replace it with your own, or untick `active` — a
cancelled bill keeps its payment history.

## Payments

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, account]
sort: [date desc]
filter: bill == 'Music streaming'
```

## Review

- [ ] Still using it?
- [ ] Price still what it was?
- [ ] Cheaper plan or yearly option?
