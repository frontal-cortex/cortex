---
created: "{{today}}"
icon: 🗓️
tags: []
title: Weekly review
type: database
views:
- name: To review
  type: table
  columns: [title, focus, days_written, carried_over]
  filter: "status == 'planned' and week <= @today-4"
  sort: [week]
- name: Weeks
  type: table
  columns: [title, status, rating, focus, areas, carried_over, days_written, energy_avg, sleep_avg]
  sort: [week desc]
- name: Board
  type: board
  group: status
- name: Calendar
  type: calendar
  date: week
- name: Rating
  type: chart
  chartType: line
  x: week
  y: rating
  agg: avg
  bucket: week
- name: Carried over
  type: chart
  chartType: bar
  x: week
  y: carried_over
  agg: sum
  bucket: week
---

One row per week. `week` is its Monday, `status` says whether you have done
the review yet, `rating` is the week out of ten, `focus` is the one sentence
you set at the start, `areas` is what the week touched (filter the table on
it), and `carried_over` counts what slipped into the next week. `reviewed_on`
fills itself in the day you set `status` to `reviewed`. If Daily Note is
installed, `days_written`, `energy_avg` and `sleep_avg` are the week's days
counted and averaged — computed from the journal, never typed.
The page is the review itself: a plan half you fill at the start of the week
and a review half — the get-clear / get-current checklist, wins, what
slipped, lessons, the carried-over list and next week's three — that takes
twenty minutes on Friday afternoon or Sunday evening.

Start with New row, any day: the row is titled "Week of" its Monday whichever
day you make it. Set `focus`, pick the Top 3 and leave it. At the end of the
week open it again, read last week's page and the week's daily notes first,
then work down the checklist, set `rating` and `carried_over`, and move
`status` to `reviewed`. Delete the two example weeks once you have a real
one.

**To review** is every week still *planned* once its Friday has come — this
week from Friday on, and any older week you have not closed. Empty is the
goal. The Board shows the same weeks by status and, with them, the *skipped*
column — an honest count. The Rating chart is one point per week; three
falling points in a row is worth a sentence in the next review. The Carried
over chart is the backlog: a bar that keeps growing means the plans are too
big, not the weeks too short.
