---
created: "{{today}}"
icon: 🏦
tags: []
title: Accounts
type: database
views:
- name: Balances
  type: table
  columns: [title, kind, balance, this_month, income, spent, moved_in, moved_out]
  filter: active == true
  sort: [kind, title]
  summary: {balance: sum}
- name: Cards
  type: gallery
  layout: compact
  size: small
  columns: [title, balance, kind]
  filter: active == true
- name: By kind
  type: board
  group: kind
  filter: active == true
---

One row per place money sits: current account, savings, cash, a credit card.
Set `initial` to what it held on the day you started logging; from then on
the balance is worked out from the ledger — income into it, spending out of
it, transfers in and out — every time you look. Nothing here is typed twice.

A transfer is one ledger row with `kind: transfer`, the account it left in
`account` and the one it reached in `to_account`, so it moves money without
counting as spending. `this_month` is what left this account in expenses
since the 1st.

Untick `active` to retire an account without losing its history. The
Balances table sums to your net position; Cards is the same as tiles, the
view the dashboard shows.
