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
  series: kind
---

One row per conversation: the date, who was there (`people` links to
Contacts, more than one is fine), what kind it was, and one line of summary.
One or two sentences, not a transcript — what they told you, what you
promised. Details and next steps go in the body.

Each person's page in Contacts embeds their own rows from here, newest first,
so you never have to search. Logging a row is also what keeps the Reach out
list honest: the person's `last_seen` is the date of their newest row here,
so there is nothing to update on their side. The calendar shows who you saw
when; the month chart, one bar per `kind`, shows whether the conversations
are happening and whether they are all messages and no meals.
