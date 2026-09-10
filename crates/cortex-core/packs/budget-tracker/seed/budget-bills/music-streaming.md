---
title: Music streaming
type: note
tags: []
icon: 🎧
amount: 10.99
repeat: monthly
repeat_mode: advance
next_due: "{{today-3}}"
paid: false
category: subscriptions
account: ["credit"]
url:
active: true
created: "{{today}}"
---

## Details

An example subscription that is three days past its date, so it shows in
Overdue and `due_in` is negative. Tick `paid` to see `next_due` jump a month
ahead and the row leave Overdue. Replace it with your own, or untick
`active` — a cancelled bill keeps its payment history.

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
