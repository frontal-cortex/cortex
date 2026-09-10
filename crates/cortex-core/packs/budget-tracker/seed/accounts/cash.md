---
title: cash
type: note
tags: []
icon: 👛
kind: cash
initial: 40
active: true
created: "{{today}}"
---

What is in your wallet. The seeded cash withdrawal tops it up and the coffee
comes out of it; the balance follows.

## Recent movements

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, kind, category]
sort: [date desc]
limit: 20
filter: account == 'cash' or to_account == 'cash'
```
