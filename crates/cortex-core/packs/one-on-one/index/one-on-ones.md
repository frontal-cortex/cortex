---
created: "{{today}}"
icon: 💬
tags: []
title: 1:1s
type: database
views:
- name: Recent
  type: table
  columns: [title, date, person, status, mood, summary]
  sort: [date desc]
- name: Planned
  type: table
  columns: [title, date, person, kind]
  filter: "status == 'planned'"
  sort: [date asc]
- name: Calendar
  type: calendar
  date: date
- name: Mood
  type: chart
  x: date
  y: title
  agg: count
  bucket: week
  series: mood
  filter: "status == 'held'"
  chartType: bar
- name: Per person
  type: chart
  x: date
  y: title
  agg: count
  bucket: month
  series: person
  filter: "status == 'held'"
  chartType: bar
---

One row per meeting. The row is the part you scan later — `date`, `person`,
`kind`, `mood`, a one-line `summary` — and the page is the part you write
during: their topics, yours, what happened since last time, wins, blockers,
growth, feedback exchanged, and the follow-ups you both took.

New row before the meeting: the date is filled in, set `person`, and paste in
the topics from their page. Afterwards, write the `summary` and set `mood`
honestly — a run of `low` weeks is the earliest signal you will get. Set
`status` to `skipped` rather than deleting a 1:1 that did not happen; the
gaps matter as much as the meetings.

The Mood chart counts held 1:1s per week by mood; Per person counts them per
month by person, which is the fairness check. Planned and skipped meetings
stay out of both.
