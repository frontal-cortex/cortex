---
created: "{{today}}"
icon: 🍳
tags: []
title: Recipes
type: database
views:
- name: Cookbook
  type: gallery
- name: By course
  type: board
  group: course
- name: Quick dinners
  type: table
  columns: [title, main, cuisine, total_minutes, to_buy, rating]
  filter: "course == 'dinner' and total_minutes <= 30"
  sort: [total_minutes]
- name: Rotation
  type: table
  columns: [title, course, main, times_cooked, last_cooked, next_planned]
  filter: "status == 'keeper'"
  sort: [last_cooked]
- name: To try
  type: table
  columns: [title, course, cuisine, difficulty, next_planned, source]
  filter: "status == 'to try'"
  sort: [created desc]
- name: All
  type: table
  columns: [title, course, cuisine, main, difficulty, total_minutes, servings, rating, times_cooked, status]
  sort: [rating desc]
---

One file per recipe. The properties are what you filter by — course,
cuisine, the main ingredient, diet, how long it takes, how much you liked it —
and the body is the recipe itself: ingredients as a checklist you can tick
while you shop or cook, the method as numbered steps, and notes on what to
change next time. Add a `cover:` image and the Cookbook view becomes a wall
of cards.

Some properties are worked out for you and never typed: `total_minutes` is
prep plus cook; `times_cooked`, `last_cooked` and `next_planned` come from
the meals that point at the recipe; `to_buy` is how many of its grocery items
are still unticked.

Start by saving three recipes you already cook. New row gives each the
template's shape; fill in `course` and the minutes, and the Quick dinners view
(dinners at 30 minutes or under, start to finish, with a count of what is
still to buy) starts answering "what can I make tonight". Rotation lists your
keepers with the one you have not made for longest at the top. Anything you
clip from the web goes in with `status: to try` and its `source` link, and the
To try view is your queue — plan one in Meals and its date shows there.

Plan the week in Meals (`collections/meals/`): one row per meal with a date, a
slot and the recipe. Each recipe's page ends with a cook log drawn from those
rows. Groceries (`collections/groceries/`) is the shopping list — items with
an aisle and a `bought` box, each linked to the recipe that wants it.
