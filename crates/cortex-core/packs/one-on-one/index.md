---
created: "{{today}}"
icon: 👥
tags: []
title: People
type: database
views:
- name: People
  type: table
  columns: [title, relationship, team, cadence, focus]
  filter: "archived != true"
  sort: [title asc]
- name: Reports
  type: table
  columns: [title, team, role, cadence, focus]
  filter: "relationship == 'report' and archived != true"
  sort: [title asc]
- name: By relationship
  type: board
  group: relationship
- name: Everyone
  type: table
  columns: [title, relationship, team, start, archived]
  sort: [start desc]
---

One page per person you meet one-to-one: a report, your manager, a peer, a
mentee. The page is the durable record — role, team, what they are working
towards, the topics you mean to raise next time, feedback you have given —
with live tables of their 1:1s and open follow-ups underneath. Everything
about a meeting lives in the 1:1s list; everything about the person lives
here.

Add a person with New row and set `relationship` and `cadence`. Before a
meeting, open their page: the topics list is the running agenda, the open
follow-ups are what to check on, and the 1:1s table (newest first) shows
when you last met. The Per person chart on the 1:1s page is the same
question across everyone, month by month.

Tick `archived` when someone moves on. They leave People and Reports but
stay in Everyone, and their 1:1s and follow-ups keep pointing at them.
