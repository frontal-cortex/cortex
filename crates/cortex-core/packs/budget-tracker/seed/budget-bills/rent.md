---
title: Rent
type: note
tags: []
icon: 🏠
amount: 1150
repeat: monthly
repeat_mode: advance
next_due: "{{today+28}}"
paid: false
category: housing
account: ["checking"]
active: true
url:
created: "{{today}}"
---

## Details

An example bill. Two seeded "Rent" transactions in the ledger point here
through their `bill` property, so `last_paid` and `total_paid` are filled in
and both appear in the list below. When you pay it, tick `paid`: `next_due`
moves a month forward and `paid` clears again. Replace the amount and
`next_due` with yours, or delete the row.

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
