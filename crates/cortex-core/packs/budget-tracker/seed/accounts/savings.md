---
title: Savings
type: note
tags: []
icon: 🐖
kind: savings
initial: 2000
active: true
created: "{{today}}"
---

Where money is put aside. Nothing is spent from here directly: the seeded
transfer from Checking moves 300 in, and that transfer is also tagged for the
Trip to Lisbon wish.

## Transfers

```cortex-view
source: collections/transfers
type: table
columns: [title, date, amount, from_account, to_account]
sort: [date desc]
limit: 15
filter: from_account == @this or to_account == @this
```
