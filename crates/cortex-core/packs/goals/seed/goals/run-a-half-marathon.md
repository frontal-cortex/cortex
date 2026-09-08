---
title: Run a half marathon
type: note
tags: []
icon: 🏃
status: on_track
area: health
timeframe: quarter
priority: high
start: "{{today}}"
target: "{{today}}"
progress: 35
measure: "Finish an official 21.1 km race, any time."
created: "{{today}}"
---

An example goal with three milestones and two check-ins, so the page shows
its shape. Replace it with one of your own, or delete all three seeded goals.

## Why

To be the kind of person who can run for two hours, and to have a date that
gets me out of the door on wet mornings.

## Done means

Crossing the line at a timed race. Pace does not matter this time.

## Milestones

```cortex-view
source: collections/goal-milestones
type: table
columns: [title, status, due]
sort: [due]
filter: goal == 'Run a half marathon'
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
filter: goal == 'Run a half marathon'
```

```cortex-view
source: collections/goal-checkins
type: table
columns: [title, date, progress, confidence]
sort: [date desc]
limit: 10
filter: goal == 'Run a half marathon'
```

## Plan

- [ ] Three runs a week, long run on Sunday
- [ ] Add 1 km to the long run each week
- [ ] Book the race once the long run passes 15 km

## In the way

Winter mornings. Lay the kit out the night before; the Exercise habit in the
Habit Tracker keeps the streak honest.
