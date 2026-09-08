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
- name: Queue
  type: table
  columns: [title, status, channel, format, due, publish, owner]
  filter: "status != 'published' and status != 'idea'"
  sort: [publish]
- name: Ideas
  type: table
  columns: [title, channel, format, pillar, priority]
  filter: "status == 'idea'"
  sort: [created desc]
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
day the draft has to be done and `publish` the day it goes out.

Start in Ideas: New row, a title, nothing else. When you commit to one, set
`channel`, `format` and a `publish` date and drag it to drafting on the
Pipeline board. The Queue lists everything in flight in publish order — the
next thing to work on is at the top. Once it is out, paste the `link`, mark
it published, and it leaves the Queue and turns up in the chart.

Group pieces into campaigns (a launch week, a series) in
`collections/campaigns/`; a campaign's page shows its pieces as a live board
and a schedule. A piece cut from another — the thread made from the article —
names its parent in `repurposed_from`, and the parent's page lists everything
made from it.
