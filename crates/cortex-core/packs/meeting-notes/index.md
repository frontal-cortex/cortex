---
created: "{{today}}"
icon: 🗓️
tags: []
title: Meetings
type: database
views:
- name: All
  type: table
  columns: [title, date, kind, status, summary]
  sort: [date desc]
- name: Upcoming
  type: table
  columns: [title, date, kind, attendees, project, link]
  filter: "status == 'scheduled'"
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
`summary` and a `link` to the call or the recording. The page carries what you
come back for: the agenda, the notes, the decisions stated as sentences, and
the action items that came out of it.

Start with New row before the meeting, or during it: the template fills in the
date and time and gives you the headings. Afterwards, write the one-line
`summary` (All shows it next to every meeting) and move `status` from
`scheduled` to `held`. Once every action item is logged and owners know about them, set it to
`followed-up`; the Follow-up board is the list of meetings that have not got
there yet.

Action items are rows in the Action items list under this one, each with an
`owner`, a `due` date and a `status`, related back to the meeting they came
from. A meeting's page shows its own items at the bottom; the Action items
page shows everything still open across all meetings, sorted by due date.
