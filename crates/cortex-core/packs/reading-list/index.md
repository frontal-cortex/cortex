---
created: "{{today}}"
icon: 📚
tags: []
title: Reading
type: database
views:
- name: Reading now
  type: table
  columns: [title, author, format, pages_read, pages, started]
  filter: "status == 'reading'"
  sort: [started desc]
- name: Shelf
  type: board
  group: status
- name: Finished
  type: table
  columns: [title, author, rating, genre, format, finished]
  filter: "status == 'finished'"
  sort: [finished desc]
- name: Per month
  type: chart
  chartType: bar
  x: finished
  agg: count
  bucket: month
- name: This week
  type: tracker
  log: collections/reading-log
  date: date
  done: book
  range: week
  filter: "status == 'reading'"
---

One row per book, article or paper. The row's page is your reading note —
why you picked it up, the ideas, the quotes worth keeping, the verdict — so
the list and the notes are one thing. `status` moves a row across the Shelf:
to read, up next, reading, finished, abandoned.

Start with New row (or edit the three examples), set `status` and, if you
like, `pages`. When you finish, set `finished`, a `rating` out of 5 and write
the verdict; the Finished view and the per-month chart fill in from there.

Sittings are optional. Each row in `collections/reading-log/` is one session:
a date, the book, the pages you got through. From those, This week draws a
grid of the books you are currently reading against the days, each book's
page shows a year heatmap of the days you read it, and the log's own page
charts pages per week. Log a sitting with New row in Reading log, or with
Space on a book in This week.
