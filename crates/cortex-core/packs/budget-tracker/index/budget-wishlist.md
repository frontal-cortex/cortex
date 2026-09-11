---
created: "{{today}}"
icon: ⭐
tags: []
title: Wishlist
type: database
views:
- name: Wishlist
  type: table
  columns: [title, priority, price, put_by, left, saved, target, category]
  filter: active == true and status != 'bought'
  sort: [saved desc]
  summary: {price: sum, put_by: sum}
- name: Cards
  type: gallery
  layout: compact
  size: small
  columns: [title, price, saved]
  filter: active == true and status != 'bought'
  sort: [saved desc]
- name: By priority
  type: board
  group: priority
  filter: active == true and status != 'bought'
- name: Bought
  type: table
  columns: [title, price, paid, bought_on, category]
  filter: status == 'bought'
  sort: [bought_on desc]
  summary: {paid: sum}
- name: Total
  type: stats
  stats:
    - {label: Items, agg: count, filter: "active == true and status != 'bought'"}
    - {label: Cost, agg: sum, field: price, filter: "active == true and status != 'bought'", format: currency}
    - {label: Saved, agg: sum, field: put_by, filter: "active == true and status != 'bought'", format: currency}
    - {label: Left, expr: "Cost - Saved", format: currency}
---

One row per thing you are saving up for: what it costs, how badly you want
it, and when you want it by. Nothing here tracks itself by hand. Tag a
transfer in the ledger with `wish` and the money counts as put by; tag the
purchase and the row moves to Bought with the date and what it actually
cost. `saved` is the share of the price you have set aside, as a bar, and
`left` is what is still to find.

Wishlist is the live list, closest to affordable first, with the total cost
and the total set aside underneath. Cards is the same rows as tiles for a
dashboard. By priority is a board — drag a row from someday to want when it
starts to matter. Bought is the history: what you bought, when, and for how
much against what you thought it would cost.

A wish is not a budget. A limit in `budget-limits` holds a category to a
number every month; a wish is one thing, once. If you are putting money
aside for it, the transfer is a real row in the ledger moving real money
between your own accounts, which is why the savings account balance and the
wish's progress agree without either being copied.

Untick `active` to drop something without losing the record that you wanted
it. That is worth as much as the list itself, six months on.
