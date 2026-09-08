---
created: "{{today}}"
icon: 🔁
tags: []
title: Follow-ups
type: database
views:
- name: Open
  type: table
  columns: [title, person, owner, due, one_on_one]
  filter: "status == 'open'"
  sort: [due asc]
- name: Mine
  type: table
  columns: [title, person, due, one_on_one]
  filter: "owner == 'me' and status == 'open'"
  sort: [due asc]
- name: Theirs
  type: table
  columns: [title, person, due, one_on_one]
  filter: "owner == 'them' and status == 'open'"
  sort: [due asc]
- name: Board
  type: board
  group: status
- name: Due
  type: calendar
  date: due
---

What was promised in a 1:1, by whom, and by when. `owner` is `me` or `them`;
`person` is who the promise concerns; `one_on_one` is the meeting it came from.
Mine is the list to clear before the next round of meetings; Theirs is what to
ask about when you sit down.

After a 1:1, add each promise with New row here and set `person` and
`one_on_one`. It then shows on that meeting's page and on the person's page
until it is `done` or `dropped`.
