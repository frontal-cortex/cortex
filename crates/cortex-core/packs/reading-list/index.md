---
created: "{{today}}"
icon: 📚
tags: []
title: Reading
type: database
views:
- name: Reading now
  type: table
  columns: [title, author, progress, pages_read, pages, last_read, days_idle]
  filter: "status == 'reading'"
  sort: [last_read]
- name: Shelf
  type: board
  group: status
- name: Finished
  type: table
  columns: [title, author, rating, genre, format, finished, days_to_finish]
  filter: "status == 'finished'"
  sort: [finished desc]
- name: Per month
  type: chart
  chartType: bar
  x: finished
  y: title
  agg: count
  bucket: month
  filter: "status == 'finished'"
- name: Timeline
  type: timeline
  start: started
  end: read_until
  filter: "started != ''"
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

Start with New row (or edit the four examples), set `status` and, if you
like, `pages`. Moving a row to `reading` stamps `started` with today; moving
it to `finished` stamps `finished`. Give it a `rating` out of 5 and write the
verdict; the Finished view shows how many days each one took and the Per
month chart counts them. The Timeline draws every book you have started as
a bar from `started` to `finished` — or to today, for the ones you are still
in — so a year of reading is one horizontal picture.

Reading now shows a `progress` bar for each book you are in — pages read
over `pages`, worked out from `pages_read` (type it when you put the book
down) or from the sittings you have logged, whichever is further along. It
is sorted with the book you have not touched for longest at the top;
`days_idle` says how long. A book with no sittings yet sits at the bottom.

Sittings are optional. Each row in `collections/reading-log/` is one session:
a date, the book, the pages you got through. From those, This week draws a
grid of the books you are currently reading against the days, each book's
page shows a year heatmap of the days you read it, and the log's own page
charts pages per week, one colour per book. Log a sitting with New row in
Reading log, or with Space on a book in This week.
