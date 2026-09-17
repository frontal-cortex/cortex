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

One row per account you track: current accounts, savings, the cash in your
wallet, credit cards. Set `initial` to what it held on the day you started
logging; everything else is computed.

`balance` is the opening amount, plus income that arrived here, minus expenses
that left from here, plus transfers in, minus transfers out. Nothing is copied
into the row, so there is nothing to keep in step: log a payment against the
account and the balance is already right the next time you look.

A credit card works the same way with the sign turned round: spending on it
lowers its balance below zero, and a transfer from checking pays it back up.
