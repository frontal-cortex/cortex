---
created: "{{today}}"
icon: 🏋️
tags: []
title: Training
type: database
width: full
---

```cortex-view
source: collections/workouts
type: stats
stats:
  - {label: Sessions, source: collections/workouts, agg: count, filter: "date >= @monday"}
  - {label: Sets, source: collections/sets, agg: count, filter: "date >= @monday and kind != warmup"}
  - {label: Volume, source: collections/sets, agg: sum, field: volume, filter: "date >= @monday and kind != warmup", format: integer}
  - {label: Last week, source: collections/sets, agg: sum, field: volume, filter: "date >= @monday-1 and date < @monday and kind != warmup", hidden: true}
  - {label: vs last week, expr: "if(last_week > 0, (volume - last_week) / last_week * 100, 0)", format: percent}
  - {label: Last session, source: collections/workouts, agg: max, field: date, hidden: true}
  - {label: Days since, expr: "days_since(last_session)", format: integer}
```

::: columns 1 2 1

## Start a session

```cortex-button
label: Push day
action: add-row
collection: workouts
values: {date: "{{today}}", day: push, title: "Push — {{today}}"}
open: true
```

```cortex-button
label: Pull day
action: add-row
collection: workouts
values: {date: "{{today}}", day: pull, title: "Pull — {{today}}"}
open: true
```

```cortex-button
label: Leg day
action: add-row
collection: workouts
values: {date: "{{today}}", day: legs, title: "Legs — {{today}}"}
open: true
```

## Records

```cortex-view
source: collections/exercises
type: list
columns: [title, best_e1rm]
filter: active == true and best_e1rm > 0
sort: [best_e1rm desc]
limit: 8
```

## Not trained lately

```cortex-view
source: collections/exercises
type: list
columns: [title, day, days_since]
filter: active == true and (days_since >= 10 or last_done is_empty)
sort: [days_since desc]
limit: 5
```

:::

## Volume per week

```cortex-view
source: collections/sets
type: chart
chartType: bar
x: date
y: volume
agg: sum
bucket: week
filter: kind != warmup and date >= @today-84
height: small
legend: false
```

## Volume per muscle, this month

```cortex-view
source: collections/sets
type: chart
chartType: bar
x: muscle
y: volume
agg: sum
filter: kind != warmup and date >= @month
height: small
legend: false
```

## Recent sessions

```cortex-view
source: collections/workouts
type: table
columns: [title, date, day, sets_done, volume, top_set]
sort: [date desc]
limit: 8
```

:::

## This month

```cortex-view
source: collections/workouts
type: chart
chartType: donut
x: day
y: title
agg: count
filter: date >= @month
labels: name_value
legend: false
height: small
```

## Heaviest sets

```cortex-view
source: collections/sets
type: list
columns: [title, date]
filter: kind != warmup
sort: [weight desc]
limit: 6
```

::: end

Press the button for today's day: it opens a session dated today. Inside it,
the table of sets is where you log — **+ New row** adds a set already pointing
at this session, so a set is an exercise, a weight and a number of reps and
nothing else to fill in. A warmup logged as `kind: warmup` stays out of every
total and every record.

Everything else is worked out when you look: a set's volume (weight × reps)
and its estimated one-rep max (Epley: weight × (1 + reps ÷ 30), left empty
above twelve reps, where the estimate stops meaning anything), a session's
volume, sets and top set, and each exercise's best weight, best estimate, last
day trained and volume over the last thirty days.

Under this page sit the databases: **Workouts** is one row per session,
**Sets** one row per set, and **Exercises** the movements you do, each with
its day, muscle and equipment. Open an exercise to see how it has gone: its
records, its estimate over time, and every set you have done of it.
