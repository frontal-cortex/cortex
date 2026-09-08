---
created: "{{today}}"
icon: 💬
tags: []
title: Interactions
type: database
views:
- name: Recent
  type: table
  columns: [title, date, people, kind, summary]
  sort: [date desc]
- name: Calendar
  type: calendar
  date: date
- name: Per month
  type: chart
  chartType: bar
  x: date
  y: title
  agg: count
  bucket: month
---

One row per conversation: the date, who was there (`people` links to
Contacts, more than one is fine), what kind it was, and one line of summary.
One or two sentences, not a transcript — what they told you, what you
promised. Details and next steps go in the body.

Each person's page in Contacts embeds their own rows from here, newest first,
so you never have to search. The calendar shows who you saw when; the month
chart shows whether the number of conversations is going the way you want.
After logging one, set the person's `last_contact` to the same date so the
Reach out list stays honest.
