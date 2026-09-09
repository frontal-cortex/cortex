---
created: "{{today}}"
icon: 🗓️
tags: []
title: Content Calendar
type: database
views:
- name: Pipeline
  type: board
  group: status
- name: Calendar
  type: calendar
  date: publish
- name: This week
  type: table
  columns: [title, status, channel, format, publish, days_left, owner]
  filter: "publish >= @monday and publish <= @sunday"
  sort: [publish]
- name: Overdue
  type: table
  columns: [title, status, channel, priority, due, publish]
  filter: "due < @today and status != 'scheduled' and status != 'published'"
  sort: [due]
- name: Queue
  type: table
  columns: [title, status, channel, format, due, publish, days_left, owner]
  filter: "status != 'published' and status != 'idea'"
  sort: [publish]
- name: Ideas
  type: table
  columns: [title, channel, format, pillar, priority]
  filter: "status == 'idea'"
  sort: [priority desc, created desc]
- name: Published per month
  type: chart
  chartType: bar
  x: publish
  y: title
  agg: count
  bucket: month
  series: channel
  filter: "status == 'published'"
---

One row per piece of content, and the row is the draft: the brief, outline
and text live in the page, so planning and writing happen in the same file.
`status` moves a piece from idea through drafting, review and scheduled to
published; `channel` says where it goes and `format` what it is; `due` is the
day the draft has to be done and `publish` the day it goes out. `days_left`
counts down to `publish` by itself.

Start in Ideas: New row, a title, nothing else — the high priority ones stay
on top. When you commit to one, set `channel`, `format` and a `publish` date
and drag it to drafting on the Pipeline board. This week is what goes out
between Monday and Sunday; Overdue is every draft whose `due` has passed and
is not yet scheduled; the Queue is everything in flight in publish order. Once
it is out, paste the `link` and mark it published: the day lands in
`published_on`, the piece leaves the Queue and turns up in the chart.

A piece that comes back — a newsletter, an episode — gets `repeat: weekly`.
Mark it published and the next one appears as a new row with its dates moved
on a week, back at idea, ready for the next issue.

Group pieces into campaigns (a launch week, a series) in
`collections/campaigns/`. A campaign counts its pieces and how many have
shipped, and its page shows them as a board and a timeline. A piece cut from
another — the thread made from the article — names its parent in
`repurposed_from`, and the parent's page lists everything made from it.
