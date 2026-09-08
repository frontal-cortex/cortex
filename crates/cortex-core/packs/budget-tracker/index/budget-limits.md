---
created: "{{today}}"
icon: 🎯
tags: []
title: Budget limits
type: database
views:
- name: Limits
  type: table
  columns: [title, bucket, monthly_limit, active]
  sort: [bucket, monthly_limit desc]
- name: Needs, wants, savings
  type: board
  group: bucket
  filter: active == true
---

One row per category you want to hold to a number. The row's title is the
category name exactly as it appears in the ledger's `category` list
(`groceries`, `dining`, ...), `monthly_limit` is the amount per month, and
`bucket` sorts it into needs, wants and savings — the 50/30/20 split, if you use
it. Open a limit and its page charts what the ledger actually recorded for
that category, month by month, with the limit written above the chart.

Not every category needs a limit. Start with the two or three that get away
from you; add the rest when you know the numbers. Untick `active` to keep a
limit's history without it showing on the board.
