---
created: "{{today}}"
icon: 💬
tags: []
title: 1:1s
type: database
views:
- name: Recent
  type: table
  columns: [title, date, person, status, mood, open_follow_ups, summary]
  sort: [date desc]
- name: This week
  type: table
  columns: [title, date, person, kind, status]
  filter: "date >= @monday and date <= @sunday"
  sort: [date asc]
- name: Planned
  type: table
  columns: [title, date, person, kind, repeat]
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
`kind`, `mood`, a one-line `summary`, and `open_follow_ups`, the count of
promises from this meeting still open — and the page is the part you write
during: their topics, yours, what happened since last time, wins, blockers,
growth, feedback exchanged, and the follow-ups you both took.

New row before the meeting: the date is filled in, set `person`, and paste in
the topics from their page. Afterwards, write the `summary` and set `mood`
honestly — a run of `low` weeks is the earliest signal you will get. Set
`status` to `skipped` rather than deleting a 1:1 that did not happen; the
gaps matter as much as the meetings.

This week is Monday to Sunday, whatever the status. Planned is everything not
yet held or skipped, soonest first — a planned 1:1 whose date has passed rises
to the top, which is the reminder to mark it. Set `repeat` on a standing 1:1
(`weekly`, `biweekly`, `monthly`) and the next occurrence is written as a
new row the moment this one is marked `held`: same title and page, `date`
moved on, `status` back to `planned`.

The Mood chart counts held 1:1s per week by mood; Per person counts them per
month by person, which is the fairness check. Planned and skipped meetings
stay out of both.
