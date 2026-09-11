---
title: "Trip to Lisbon"
type: note
tags: []
icon: ✈️
price: 650
priority: want
category: travel
url:
target: "{{today+120}}"
active: true
created: "{{today}}"
---

An example of a wish you are saving towards. The seeded transfer to savings
is tagged `wish: [Trip to Lisbon]`, so 300 of the 650 shows as put by and
the bar is part filled on the day you install. Tag your own transfers the
same way and the two numbers stay in step, because the money really did move
between your accounts.

## Money put aside

```cortex-view
source: collections/budget
type: table
columns: [title, date, amount, account, to_account]
sort: [date desc]
filter: wish == 'Trip to Lisbon' and kind == 'transfer'
summary: {amount: sum}
```
