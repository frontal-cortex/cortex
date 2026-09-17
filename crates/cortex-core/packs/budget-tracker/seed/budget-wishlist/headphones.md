---
title: "Headphones"
type: note
tags: []
icon: 🎧
price: 200
priority: must
category: shopping
url:
target:
active: true
created: "{{today}}"
---

An example of a wish already bought. The seeded expense has `wish:
[Headphones]`, so this row moved itself to the Bought view with the date and
what it really cost — 180 against the 200 guessed here. Nothing was ticked to
make that happen.

## What it cost

```cortex-view
source: collections/expenses
type: table
columns: [title, date, amount, category, account, payee]
sort: [date desc]
filter: wish == @this
summary: {amount: sum}
```
