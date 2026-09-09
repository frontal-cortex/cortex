---
created: "{{today}}"
icon: 🛒
tags: []
title: Groceries
type: database
views:
- name: To buy
  type: table
  columns: [title, quantity, aisle, recipe, bought]
  filter: "bought == false"
  sort: [aisle]
- name: By aisle
  type: board
  group: aisle
  filter: "bought == false"
- name: All
  type: table
  columns: [title, quantity, aisle, recipe, bought]
  sort: [created desc]
---

The shopping list. One row per item with a `quantity`, an `aisle` and the
`recipe` that wants it. To buy is the list for the shop, sorted by `aisle` in
the order the options are declared in the schema — put them in the order you
walk your shop and the list walks it with you; By aisle is the same list as a
board. Tick `bought` as you go and the row drops off both. Nothing is deleted,
so the All view remembers what you buy and the next list starts from it —
untick `bought` on the staples and they are back on the list.
