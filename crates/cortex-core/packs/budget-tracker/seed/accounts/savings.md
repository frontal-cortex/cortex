---
title: savings
type: note
tags: []
icon: 🌱
kind: savings
initial: 4000
active: true
created: "{{today}}"
---

Money set aside. The seeded "Move to savings" transfer lands here, so the
balance is the opening amount plus that. Replace the opening amount with
your own.

## Recent movements

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, kind, category, account]
sort: [date desc]
limit: 20
filter: account == 'savings' or to_account == 'savings'
```
