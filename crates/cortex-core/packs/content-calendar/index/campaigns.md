---
created: "{{today}}"
icon: 📣
tags: []
title: Campaigns
type: database
views:
- name: Board
  type: board
  group: status
- name: Table
  type: table
  columns: [title, status, start, end, goal]
  sort: [start desc]
- name: Calendar
  type: calendar
  date: start
---

A campaign is a bundle of content with one goal and a window: a launch week,
a monthly series, a course promotion. It is a row here; the pieces stay in
Content and point at it through their `campaign` property. Open a campaign to
see its pieces as a board and a schedule, and to write the retro when it ends.
