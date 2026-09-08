---
created: "{{today}}"
icon: ✅
tags: []
title: Action items
type: database
views:
- name: Open
  type: table
  columns: [title, owner, due, status, meeting]
  filter: "status != 'done' and status != 'dropped'"
  sort: [due asc]
- name: Mine
  type: table
  columns: [title, due, status, meeting]
  filter: "owner == @me and status != 'done' and status != 'dropped'"
  sort: [due asc]
- name: Board
  type: board
  group: status
- name: Due
  type: calendar
  date: due
- name: By week
  type: chart
  x: due
  y: title
  agg: count
  bucket: week
  series: status
  chartType: bar
---

One row per action item, related to the meeting it came from. An item is a
verb, one owner and a date: "Send the summary to the client — owner, Friday",
not "summary". Add one from the meeting's page or with New row here, pick the
`meeting`, set `owner` and `due`, and it appears in the meeting's own table
and in Open.

Open is the working list, sorted by what is due first. Mine is the same list
filtered to you (`@me` is the vault member matching your git name or email). Move an item
across the Board as it progresses; `dropped` is for the ones you decided not
to do, so they stop nagging without pretending they were done.
