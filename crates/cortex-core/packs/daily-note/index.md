---
created: "{{today}}"
icon: 📓
tags: []
title: Journal
type: database
views:
- name: This week
  type: table
  columns: [title, mood, energy, sleep, highlight]
  filter: "date >= @monday"
  sort: [date]
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
  x: date
  bucket: month
  series: mood
  y: title
  agg: count
---

One row per day. The frontmatter is the part you can chart — `mood`, `energy`
(1–5, shown as stars), `sleep` (hours), the `areas` the day touched and a
one-line `highlight` — and the body is the day itself: what you meant to do,
what happened, what you noticed. Thirty seconds for the properties, three
minutes for the page.

Start with New row. The template titles it with today's date, stamps the first
log line with the time, names the week it belongs to, and leaves the
properties empty so you can fill them now or tonight. The Calendar shows
which days you wrote; the gaps are information too. Delete the two example
days once you have a real one.

**This week** is the days since Monday, in order — read them before a weekly
review; that is what they are for. The rest grows on its own. After a
fortnight the Energy and Sleep charts have a weekly average per point and a
slow slide is visible before you would have named it; the Moods chart stacks
each month's days by mood, best to worst, so a grey month shows as one; the
Days table sorted newest-first is the place to search for a name or a
decision. `week` names the week's row in Weekly Review, if you use it — that
pack counts the days you wrote and averages energy and sleep per week from
here, so there is nothing to copy across.
