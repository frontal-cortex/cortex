---
created: "{{today}}"
icon: 🗓️
tags: []
title: Meetings
type: database
views:
- name: All
  type: table
  columns: [title, date, kind, status, open_items, progress, summary]
  sort: [date desc]
- name: This week
  type: table
  columns: [title, date, kind, status, attendees, open_items, link]
  filter: "date >= @monday and date <= @sunday"
  sort: [date asc]
- name: Upcoming
  type: table
  columns: [title, date, kind, attendees, project, repeat, link]
  filter: "status == 'scheduled' and date >= @today"
  sort: [date asc]
- name: To write up
  type: table
  columns: [title, date, kind, attendees, project]
  filter: "status == 'scheduled' and date < @today"
  sort: [date asc]
- name: Calendar
  type: calendar
  date: date
- name: Follow-up
  type: board
  group: status
- name: Per week
  type: chart
  x: date
  y: title
  agg: count
  bucket: week
  series: kind
  chartType: bar
---

Every meeting is a row here and a page of its own. The row carries what you
filter on — `date`, `kind`, `status`, `attendees`, `project`, a one-line
`summary` and a `link` to the call or the recording — and two numbers the
engine works out from the Action items list: `open_items`, how many of this
meeting's items are still open, and `progress`, the share that are closed.
The page carries what you come back for: the agenda, the notes, the decisions
stated as sentences, and the action items that came out of it.

Start with New row before the meeting, or during it: the template fills in the
date and time and gives you the headings. Afterwards, write the one-line
`summary` (All shows it next to every meeting) and move `status` from
`scheduled` to `held`. Once every action item is logged and owners know about
them, set it to `followed-up`; the Follow-up board is the list of meetings
that have not got there yet.

This week is the calendar as a list, Monday to Sunday. Upcoming is what is
still to come; To write up is the other half — meetings whose date has passed
while the row still says `scheduled`, so nothing slips through unwritten. Set
`repeat` on a standing meeting (`weekly`, `biweekly`, `monthly`, `quarterly`)
and the next occurrence appears the moment this one is marked `followed-up`:
a copy of this page with the date moved on and the status back to `scheduled`.

Action items are rows in the Action items list under this one, each with an
`owner`, a `due` date and a `status`, related back to the meeting they came
from. A meeting's page shows its own items at the bottom; the Action items
page shows everything still open across all meetings, sorted by due date.
