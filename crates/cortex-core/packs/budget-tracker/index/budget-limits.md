---
created: "{{today}}"
icon: 🎯
tags: []
title: Budget limits
type: database
views:
- name: This month
  type: table
  columns: [title, bucket, monthly_limit, spent, remaining, used, last_month]
  filter: active == true
  sort: [used desc]
- name: Needs, wants, savings
  type: board
  group: bucket
  filter: active == true
---

One row per category you want to hold to a number. The row's title is the
category name exactly as it appears in the ledger's `category` list
(`groceries`, `dining`, ...) and `monthly_limit` is the amount per month.
Everything else is computed when you look: `spent` sums this month's ledger
rows in that category, `remaining` is the limit minus that, `used` is the
share of the limit gone as a bar, and `last_month` is the same sum for the
previous month, so a category that was over last month too stands out.

This month is the budget check, worst first. `bucket` sorts limits into
needs, wants and savings — the 50/30/20 split, if you use it — and the board
shows them that way. Open a limit and its page charts that category month by
month with the latest rows under it.

Not every category needs a limit. Start with the two or three that get away
from you; add the rest when you know the numbers. Untick `active` to keep a
limit's history without it showing here.
