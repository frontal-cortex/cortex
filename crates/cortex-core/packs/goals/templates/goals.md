---
title: "{{title}}"
type: note
tags: []
status: planned
area: health
timeframe: quarter
priority: medium
start: "{{date}}"
target:
progress: 0
measure:
created: "{{date}}"
---

## Why

What changes when this is done, and why now.

## Done means

The `measure` in a sentence or two: the number, the event, the thing you can
point at.

## Milestones

New row here creates a milestone already linked to this goal.

```cortex-view
source: collections/goal-milestones
type: table
columns: [title, status, due]
sort: [due]
filter: goal == '{{title}}'
```

## Progress

New row under the table, from the `goal-checkins` template, adds a check-in
for this goal dated today.

```cortex-view
source: collections/goal-checkins
type: chart
chartType: line
x: date
y: progress
bucket: week
agg: max
filter: goal == '{{title}}'
```

```cortex-view
source: collections/goal-checkins
type: table
columns: [title, date, progress, confidence]
sort: [date desc]
limit: 10
filter: goal == '{{title}}'
```

## Plan

The next three actions, in order.

- [ ]
- [ ]
- [ ]

## In the way

What has stopped this before, and what you will do about it this time.
