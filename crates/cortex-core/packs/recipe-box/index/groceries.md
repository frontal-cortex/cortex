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
`recipe` that wants it. To buy is the list for the shop, sorted so you walk
the aisles once, and By aisle is the same list as a board; tick `bought` as
you go and the row drops off both. Nothing is deleted, so the All view
remembers what you buy and the next list starts from it — untick `bought` on
the staples and they are back on the list.
