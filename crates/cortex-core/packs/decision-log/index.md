---
created: "{{today}}"
icon: ⚖️
tags: []
title: Decisions
type: database
views:
- name: Log
  type: table
  columns: [title, status, area, impact, decided, review, outcome]
  sort: [created desc]
- name: Board
  type: board
  group: status
- name: Due for review
  type: table
  columns: [title, review, confidence, impact, area, owner]
  filter: "status == 'accepted' and outcome == 'pending'"
  sort: [review]
- name: Review calendar
  type: calendar
  date: review
- name: Outcomes by month
  type: chart
  chartType: bar
  x: decided
  y: title
  agg: count
  bucket: month
  series: outcome
  filter: "decided != ''"
---

One row per decision, written before you act. The page holds the context,
the options that were on the table, what was chosen and the one reason that
carried it, what you expect to happen and how sure you are. Six months later
that page is the answer to "why on earth did we do this".

Start with New row. Fill in Context, Options and Decision, set `status` to
`accepted` when it is made, and give it a `review` date — a month for small
things, a quarter for big ones. Log shows every row, newest first; the Board
groups them by `status`. Due for review lists accepted decisions with no
`outcome` yet, soonest first; the Review calendar shows the same dates on a
month.

On the review date, open the page, write what actually happened under
Review, and set `outcome`: as expected, better, worse or unclear. Outcomes by
month then shows, over time, how often your expectations held. When a
decision replaces an older one, set the new row's `supersedes` to the old
title and the old row's `status` to `superseded`; the old page lists what
replaced it. Nothing is deleted, so the record stays honest.
