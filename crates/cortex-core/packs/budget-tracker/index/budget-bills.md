---
created: "{{today}}"
icon: 🔁
tags: []
title: Bills and subscriptions
type: database
views:
- name: Upcoming
  type: table
  columns: [title, amount, repeat, next_due, due_in, paid, account]
  filter: active == true and next_due <= @today+30
  sort: [next_due]
- name: Overdue
  type: table
  columns: [title, amount, next_due, due_in, last_paid, account]
  filter: active == true and next_due < @today
  sort: [next_due]
- name: Per month
  type: table
  columns: [title, amount, repeat, monthly, category, last_paid, total_paid]
  filter: active == true
  sort: [monthly desc]
- name: Calendar
  type: calendar
  date: next_due
- name: By cycle
  type: board
  group: repeat
  filter: active == true
---

Everything that charges you on a schedule: rent, utilities, insurance,
streaming, the gym. One row each with its amount, how often it `repeat`s, and
`next_due`, the date the next charge lands.

When a bill is paid, tick `paid`. Because every row carries `repeat_mode:
advance`, the app moves `next_due` forward by one cycle and unticks `paid`
again in the same row — nothing to retype. Log the payment in the ledger as
usual with its `bill` set to this row; the bill then knows `last_paid` and
`total_paid`, and its page lists every payment, which is where you notice a
price rise.

Upcoming is what lands in the next thirty days, with `due_in` counting the
days. Overdue is what passed its date without being ticked — empty is the
right state. Per month puts every bill on the same footing (`monthly` turns a
yearly or weekly amount into a per-month cost) and sorts by it, which is the
list to read when cancelling something. The calendar shows a thin week before
it arrives. Untick `active` when you cancel; the history stays.
