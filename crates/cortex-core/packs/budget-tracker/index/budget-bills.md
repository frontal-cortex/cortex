---
created: "{{today}}"
icon: 🔁
tags: []
title: Bills and subscriptions
type: database
views:
- name: Upcoming
  type: table
  columns: [title, amount, cycle, next_due, category, account, active]
  filter: active == true
  sort: [next_due]
- name: Calendar
  type: calendar
  date: next_due
- name: By cycle
  type: board
  group: cycle
  filter: active == true
---

Everything that charges you on a schedule: rent, utilities, insurance,
streaming, the gym. One row each with its amount, its `cycle`, and `next_due`,
the date the next charge lands. Upcoming is the list in date order; the
calendar is the same thing laid over the month, so a thin week is visible
before it arrives.

When a bill is paid, log it in the ledger as usual and set the transaction's
`bill` to this row — the bill's page then lists every payment you have made
against it, which is where you notice a price rise. Move `next_due` forward
by hand when you log the payment; the app does not advance it for you yet.
Untick `active` when you cancel something; the history stays.
