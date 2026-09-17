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

An example of a wish you are saving towards. The seeded transfer into Savings
is set aside for it, so 300 of the 650 shows as put by and the ring is part
filled on the day you install.

## Money put aside

```cortex-view
source: collections/transfers
type: table
columns: [title, date, amount, from_account, to_account]
sort: [date desc]
filter: wish == @this
summary: {amount: sum}
```
