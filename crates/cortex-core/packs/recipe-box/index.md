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
  columns: [title, main, cuisine, prep_minutes, cook_minutes, rating]
  filter: "course == 'dinner' and cook_minutes >= 0 and cook_minutes <= 30"
  sort: [cook_minutes]
- name: To try
  type: table
  columns: [title, course, cuisine, difficulty, source]
  filter: "status == 'to try'"
  sort: [created desc]
- name: All
  type: table
  columns: [title, course, cuisine, main, difficulty, cook_minutes, servings, rating, status]
  sort: [rating desc]
---

One file per recipe. The properties are what you filter by — course,
cuisine, the main ingredient, diet, how long it takes, how much you liked it —
and the body is the recipe itself: ingredients as a checklist you can tick
while you shop or cook, the method as numbered steps, and notes on what to
change next time. Add a `cover:` image and the Cookbook view becomes a wall
of cards.

Start by saving three recipes you already cook. New row gives each the
template's shape; fill in `course`, `main` and the minutes, and the Quick
dinners view (dinners with `cook_minutes` set, 30 or under) starts answering
"what can I make tonight in half an hour". Anything you clip from the web goes
in with `status: to try` and its `source` link, and the To try view is your
queue.

Plan the week in Meals (`collections/meals/`): one row per meal with a date, a
slot and the recipe. Each recipe's page ends with a cook log drawn from those
rows, so you can see when you last made it. Groceries
(`collections/groceries/`) is the shopping list — items with an aisle and a
`bought` box, each linked to the recipe that wants it.
