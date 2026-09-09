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
  columns: [title, status, start, end, shipped, progress, goal]
  sort: [start desc]
- name: Timeline
  type: timeline
  start: start
  end: end
---

A campaign is a bundle of content with one goal and a window: a launch week,
a monthly series, a course promotion. It is a row here; the pieces stay in
Content and point at it through their `campaign` property, and the campaign
counts them back — `pieces` lists them, `shipped` is how many are published
and `progress` the share, all worked out on read. The Timeline lays each
campaign's `start` to `end` across the weeks with today marked. Open a
campaign to see its pieces as a board and a schedule, and to write the retro
when it ends.
