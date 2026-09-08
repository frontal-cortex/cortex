---
title: Rent
type: note
tags: []
icon: 🏠
amount: 1150
cycle: monthly
next_due: "{{today}}"
category: housing
account: checking
active: true
url:
created: "{{today}}"
---

## Details

An example bill. The seeded "Rent" transaction in the ledger points here
through its `bill` property, so it appears in the list below. Replace the
amount and `next_due` with yours, or delete the row.

## Payments

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, account]
sort: [date desc]
filter: bill == 'Rent'
```

## Review

- [ ] Still using it?
- [ ] Price still what it was?
- [ ] Cheaper plan or yearly option?
