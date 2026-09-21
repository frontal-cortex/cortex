---
title: "{{title}}"
type: note
tags: []
day: push
muscle: chest
equipment: barbell
target_reps: "6-8"
rest: 150
active: true
width: full
created: "{{date}}"
---

<!-- Set the day, the muscle and the equipment. Everything below is read from the sets you have logged of this movement. -->

```cortex-view
source: collections/exercises
type: stats
stats:
  - {label: Best estimate, source: collections/sets, agg: max, field: e1rm, filter: "exercise == @this and kind != warmup", format: integer}
  - {label: Heaviest, source: collections/sets, agg: max, field: weight, filter: "exercise == @this and kind != warmup", format: decimal}
  - {label: Sets, source: collections/sets, agg: count, filter: "exercise == @this and kind != warmup"}
  - {label: Volume, source: collections/sets, agg: sum, field: volume, filter: "exercise == @this and kind != warmup", format: integer}
  - {label: Last done, source: collections/sets, agg: max, field: date, filter: "exercise == @this"}
```

## Estimate over time

```cortex-view
source: collections/sets
type: chart
chartType: line
x: date
y: e1rm
agg: max
bucket: week
filter: exercise == @this and kind != warmup
height: small
legend: false
```

## Every set

```cortex-view
source: collections/sets
type: table
columns: [date, weight, reps, rpe, e1rm, kind]
filter: exercise == @this
sort: [date desc]
limit: 40
```

## Cues

Pin height, seat number, what to think about. The thing you will have
forgotten by next week.
