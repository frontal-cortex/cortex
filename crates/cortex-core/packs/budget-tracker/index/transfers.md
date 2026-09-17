---
created: "{{today}}"
icon: 🔄
tags: []
title: Transfers
type: database
views:
- name: Recent
  type: list
  columns: [title, amount, from_account, to_account, date]
  sort: [date desc]
  limit: 25
- name: Monthly
  type: list
  columns: [title, amount, from_account, to_account]
  sort: [date desc]
  group: date
  bucket: month
  summary: {amount: sum}
---

Money moving between your own accounts: into savings, paying off a credit
card, taking cash out. Every row has both ends — `from_account`, where it
left, and `to_account`, where it landed — so the first account's balance goes
down and the second's goes up by the same amount, and neither counts as
spending or income.

Putting money aside for something on the wishlist is a transfer too: set
`wish` on it and the wish counts it as saved.
