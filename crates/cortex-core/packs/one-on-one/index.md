---
created: "{{today}}"
icon: 👥
tags: []
title: People
type: database
views:
- name: People
  type: table
  columns: [title, relationship, team, cadence, last_met, open_follow_ups, focus]
  filter: "archived != true"
  sort: [title asc]
- name: Due
  type: table
  columns: [title, cadence, last_met, days_since_met, next_planned, open_follow_ups]
  filter: "due == true and archived != true"
  sort: [last_met asc]
- name: Weekly
  type: tracker
  log: collections/one-on-ones
  date: date
  done: person
  range: month
  frequency: cadence
  filter: "cadence == 'weekly'"
- name: Reports
  type: table
  columns: [title, team, role, cadence, last_met, held_90d, focus]
  filter: "relationship == 'report' and archived != true"
  sort: [title asc]
- name: By relationship
  type: board
  group: relationship
- name: Everyone
  type: table
  columns: [title, relationship, team, start, last_met, archived]
  sort: [start desc]
---

One page per person you meet one-to-one: a report, your manager, a peer, a
mentee. The page is the durable record — role, team, what they are working
towards, the topics you mean to raise next time, feedback you have given —
with live tables of their 1:1s and open follow-ups underneath. Everything
about a meeting lives in the 1:1s list; everything about the person lives
here.

The row carries a few numbers the engine works out from the other two lists:
`last_met` is the date of the last held 1:1, `next_planned` the next one on
the books, `held_90d` how many you have held in the last ninety days, and
`open_follow_ups` what is still outstanding between you. `days_since_met`
and `due` follow from those and the person's `cadence`: someone is due when
the gap since you last met has reached their cadence (a week, two, a month),
or when you have never met; `ad-hoc` people are never due.

Add a person with New row and set `relationship` and `cadence`. Due is the
list to book from — who has waited longer than their cadence, and whether a
meeting is already planned. Weekly is a tracker of the weekly-cadence people
against the 1:1s list: one column per day this month, a tick on each day you
met, so a missed week shows as a gap. Before a meeting, open their page: the
topics list is the running agenda, the open follow-ups are what to check on,
and the 1:1s table (newest first) shows when you last met. The Per person
chart on the 1:1s page is the same question across everyone, month by month.

Tick `archived` when someone moves on. They leave People, Due and Reports but
stay in Everyone, and their 1:1s and follow-ups keep pointing at them.
