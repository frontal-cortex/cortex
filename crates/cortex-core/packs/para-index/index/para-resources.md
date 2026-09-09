---
created: "{{today}}"
icon: 📚
tags: []
title: Resources
type: database
views:
- name: All
  type: table
  columns: [title, kind, area, project, status, url]
  filter: status != 'archived'
  sort: [created desc]
- name: By kind
  type: board
  group: kind
  filter: status != 'archived'
- name: Inbox
  type: table
  columns: [title, kind, url, created, age]
  filter: status == 'inbox'
  sort: [created]
- name: Added per month
  type: chart
  chartType: bar
  x: created
  bucket: month
  series: kind
  agg: count
- name: Archive
  type: table
  columns: [title, kind, area, project]
  filter: status == 'archived'
  sort: [created desc]
---

A resource is anything you keep because it might be useful later and nothing
is asking you to act on it: an article, a book, a video, a tool, a reference
sheet, a template. New ones land in `inbox`; when you have read or filed it,
set `active` and link the area or project it supports, so it shows up on that
page when you need it.

Put the link in `url` and your notes in the body — the highlights, the two
points you want to remember, why it mattered. A resource with no notes is a
bookmark; the notes are what make it yours.

When a resource stops being useful, set `archived` rather than deleting it.
The Inbox view is the one to empty during a weekly review: it lists the
oldest first, and `age` is how many days each has been waiting. The month
chart is split by `kind`, so you can see whether you are collecting articles
you never read.
