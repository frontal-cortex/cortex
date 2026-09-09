---
title: Read 24 books
type: note
tags: []
icon: 📚
status: at_risk
area: learning
timeframe: year
priority: low
start: "{{today-250}}"
target: "{{today+115}}"
measure: "24 books finished and logged in the reading list."
created: "{{today}}"
---

An example goal that is drifting — it sits in the yellow column of the Board,
its only check-in is three weeks old, so it is in Due for review too. The
Reading List pack is where the individual books live.

## Why

Two a month is the pace at which reading stays a habit instead of a thing I
used to do.

## Done means

Twenty-four entries with a finish date in the reading list by the end of the
year.

## Milestones

```cortex-view
source: collections/goal-milestones
type: table
columns: [title, status, due]
sort: [due]
filter: goal == 'Read 24 books'
```

## Progress

```cortex-view
source: collections/goal-checkins
type: chart
chartType: line
x: date
y: progress
bucket: week
agg: max
filter: goal == 'Read 24 books'
```

```cortex-view
source: collections/goal-checkins
type: table
columns: [title, date, progress, confidence]
sort: [date desc]
limit: 10
filter: goal == 'Read 24 books'
```

## Plan

- [ ] Twenty pages before the phone in the morning
- [ ] Always have the next book chosen
- [ ] Drop any book that is not working by page 50

## In the way

Long books in autumn. Mix in short ones.
