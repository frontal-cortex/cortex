---
title: "{{title}}"
type: note
tags: []
date: "{{date}}"
day: push
duration: 0
feel: fine
width: full
created: "{{date}}"
---

<!-- Log the session in the table below: + New row adds a set that already belongs to this session. Pick the movement, type the weight and the reps. -->

```cortex-view
source: collections/workouts
type: stats
stats:
  - {label: Volume, source: collections/sets, agg: sum, field: volume, filter: "workout == @this and kind != warmup", format: integer}
  - {label: Sets, source: collections/sets, agg: count, filter: "workout == @this and kind != warmup"}
  - {label: Reps, source: collections/sets, agg: sum, field: reps, filter: "workout == @this and kind != warmup", format: integer}
  - {label: Top set, source: collections/sets, agg: max, field: weight, filter: "workout == @this and kind != warmup", format: decimal}
  - {label: Hard sets, source: collections/sets, agg: count, filter: "workout == @this and rpe >= 8"}
```

## Sets

```cortex-view
source: collections/sets
type: table
columns: [exercise, weight, reps, rpe, kind, volume, e1rm]
filter: workout == @this
sort: [created]
```

## How it went

What felt heavy, what to change next time.
