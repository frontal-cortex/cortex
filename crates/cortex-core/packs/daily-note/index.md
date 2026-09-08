---
created: "{{today}}"
icon: 📓
tags: []
title: Journal
type: database
views:
- name: Calendar
  type: calendar
  date: date
- name: Days
  type: table
  columns: [title, mood, energy, sleep, areas, highlight]
  sort: [date desc]
- name: Energy
  type: chart
  chartType: line
  x: date
  y: energy
  agg: avg
  bucket: week
- name: Sleep
  type: chart
  chartType: line
  x: date
  y: sleep
  agg: avg
  bucket: week
- name: Moods
  type: chart
  chartType: bar
  x: mood
  y: title
  agg: count
---

One row per day. The frontmatter is the part you can chart — `mood`, `energy`
(1–5), `sleep` (hours), the `areas` the day touched and a one-line
`highlight` — and the body is the day itself: what you meant to do, what
happened, what you noticed. Thirty seconds for the properties, three minutes
for the page.

Start with New row. The template titles it with today's date, stamps the first
log line with the time, and leaves the properties empty so you can fill them
now or tonight. The Calendar shows which days you wrote; the gaps are
information too. Delete the two example days once you have a real one.

It grows on its own. After a fortnight the Energy and Sleep charts have a
weekly average per point and a slow slide is visible before you would have
named it; the Moods chart counts how the months have felt; the Days table
sorted newest-first is the place to search for a name or a decision. Read the
last seven pages before a weekly review — that is what they are for.
