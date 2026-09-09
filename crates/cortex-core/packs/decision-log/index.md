---
created: "{{today}}"
icon: ⚖️
tags: []
title: Decisions
type: database
views:
- name: Log
  type: table
  columns: [title, status, area, impact, decided, review, outcome, superseded_by]
  sort: [created desc]
- name: Board
  type: board
  group: status
- name: Due for review
  type: table
  columns: [title, review, days_to_review, confidence, impact, area, owner]
  filter: "status == 'accepted' and outcome == 'pending' and review <= @today+30"
  sort: [review]
- name: Timeline
  type: timeline
  start: decided
  end: review
- name: Outcomes by month
  type: chart
  chartType: bar
  x: decided
  y: title
  agg: count
  bucket: month
  series: outcome
  filter: "decided != ''"
- name: Calibration
  type: chart
  chartType: bar
  x: confidence_band
  y: title
  agg: count
  series: outcome
  filter: "outcome != 'pending' and confidence != ''"
---

One row per decision, written before you act. The page holds the context,
the options that were on the table, what was chosen and the one reason that
carried it, what you expect to happen and how sure you are. Six months later
that page is the answer to "why on earth did we do this".

Start with New row. Fill in Context, Options and Decision, and give it a
`review` date — a month for small things, a quarter for big ones. When it is
made, set `status` to `accepted`: `decided` is stamped with today (so is a
rejection). Log shows every row, newest first, with `superseded_by` filled
in for any decision a later one replaced; the Board groups them by
`status`.

Due for review lists accepted decisions with no `outcome` yet whose review
date is within the next thirty days or already past, soonest first;
`days_to_review` counts down and goes negative when you are late. The
Timeline draws each decision as a bar from the day it was `decided` to its
`review` date, with today marked, so you can see what is in flight and when
the reckonings land.

On the review date, open the page, write what actually happened under
Review, and set `outcome`: as expected, better, worse or unclear. That stamps
`reviewed`. Outcomes by month then shows, over time, how often your
expectations held, and Calibration groups reviewed decisions by the
`confidence` you wrote down, in bands of ten, one colour per outcome — the
bar at 80% should be mostly green; if it is not, you are overconfident.
When a decision replaces an older one, set the new row's `supersedes` to the
old title and the old row's `status` to `superseded`; the old row's
`superseded_by` fills in by itself. Nothing is deleted, so the record stays
honest.
