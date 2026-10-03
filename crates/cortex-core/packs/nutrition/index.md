---
created: "{{today}}"
icon: 🥗
tags: []
title: Nutrition
type: database
width: full
---

```cortex-view
source: collections/food-log
type: stats
stats:
  - {label: Calorie target, source: collections/nutrition-targets, agg: max, field: calories, filter: "active == true", hidden: true}
  - {label: Protein target, source: collections/nutrition-targets, agg: max, field: protein, filter: "active == true", hidden: true}
  - {label: Fibre target, source: collections/nutrition-targets, agg: max, field: fibre, filter: "active == true", hidden: true}
  - {label: Eaten, source: collections/food-log, agg: sum, field: calories, filter: "date == @today", hidden: true}
  - {label: Protein eaten, source: collections/food-log, agg: sum, field: protein, filter: "date == @today", hidden: true}
  - {label: Fibre eaten, source: collections/food-log, agg: sum, field: fibre, filter: "date == @today", hidden: true}
  - {label: Calories, expr: "if(calorie_target > 0, round(100 * eaten / calorie_target), empty)", format: ring}
  - {label: Calories left, expr: "calorie_target - eaten", format: integer}
  - {label: Protein, expr: "if(protein_target > 0, min(round(100 * protein_eaten / protein_target), 100), empty)", format: ring}
  - {label: Protein left, expr: "max(protein_target - protein_eaten, 0)", format: integer}
  - {label: Fibre, expr: "if(fibre_target > 0, min(round(100 * fibre_eaten / fibre_target), 100), empty)", format: ring}
  - {label: Fibre left, expr: "max(fibre_target - fibre_eaten, 0)", format: integer}
```

::: columns 3 1

## Today

```cortex-view
source: collections/food-log
type: table
columns: [meal, food, servings, calories, protein, fibre]
filter: date == @today
sort: [created]
summary: {calories: sum, protein: sum, fibre: sum}
```

## Log something

```cortex-button
label: Breakfast
action: add-row
collection: food-log
values: {date: "{{today}}", meal: breakfast, servings: 1, title: "Breakfast {{today}}"}
open: true
```

```cortex-button
label: Lunch
action: add-row
collection: food-log
values: {date: "{{today}}", meal: lunch, servings: 1, title: "Lunch {{today}}"}
open: true
```

```cortex-button
label: Dinner
action: add-row
collection: food-log
values: {date: "{{today}}", meal: dinner, servings: 1, title: "Dinner {{today}}"}
open: true
```

```cortex-button
label: Snack
action: add-row
collection: food-log
values: {date: "{{today}}", meal: snack, servings: 1, title: "Snack {{today}}"}
open: true
```

```cortex-button
label: Weigh in
action: add-row
collection: weigh-ins
values: {date: "{{today}}", title: "{{today}}"}
open: true
```

:::

## Eaten most, last 30 days

```cortex-view
source: collections/foods
type: list
columns: [title, calories, protein]
filter: logged_30d > 0
sort: [logged_30d desc]
limit: 8
```

::: end

## The last seven days

```cortex-view
source: collections/food-log
type: stats
stats:
  - {label: Calorie target, source: collections/nutrition-targets, agg: max, field: calories, filter: "active == true", hidden: true}
  - {label: Week calories, source: collections/food-log, agg: sum, field: calories, filter: "date >= @today-6", hidden: true}
  - {label: Week protein, source: collections/food-log, agg: sum, field: protein, filter: "date >= @today-6", hidden: true}
  - {label: Week fibre, source: collections/food-log, agg: sum, field: fibre, filter: "date >= @today-6", hidden: true}
  - {label: Calories a day, expr: "round(week_calories / 7)", format: integer}
  - {label: Protein a day, expr: "round(week_protein / 7)", format: integer}
  - {label: Fibre a day, expr: "round(week_fibre / 7)", format: integer}
  - {label: vs target, expr: "if(calorie_target > 0, round(100 * (week_calories / 7) / calorie_target), empty)", format: ring}
  - {label: Weight, source: collections/weigh-ins, agg: avg, field: weight, filter: "date >= @today-6", format: decimal}
```

An average over seven days counts the days you did not log as zeroes, which is
what makes it honest: a week with two unlogged days reads low, and it should.
The bars below say which days those were.

## Calories per day

```cortex-view
source: collections/food-log
type: chart
chartType: bar
x: date
y: calories
agg: sum
bucket: day
filter: date >= @today-13
height: small
legend: false
```

## Protein per day

```cortex-view
source: collections/food-log
type: chart
chartType: bar
x: date
y: protein
agg: sum
bucket: day
filter: date >= @today-13
height: small
legend: false
```

::: columns 1 1

## Weight, by week

```cortex-view
source: collections/weigh-ins
type: chart
chartType: line
x: date
y: weight
agg: avg
bucket: week
filter: date >= @today-119
height: small
legend: false
```

:::

## Where the protein came from

```cortex-view
source: collections/food-log
type: chart
chartType: donut
x: food
y: protein
agg: sum
filter: date >= @today-29
limit: 5
labels: name
legend: false
height: small
```

::: end

Press a meal to log something: it opens a row where you pick the food and say
how many servings. Quicker still: open a food you eat often and press the meal
on its own page — one press, one serving, logged. **+ New row** in today's
table does the same with the date already filled in. For something someone
else cooked, leave the food empty and put what you know into `own_calories`,
`own_protein` and `own_fibre`.

Every number is worked out when you look at it. A food carries the macros of
one serving; a logged row is that food times the servings; the day is those
rows added up; the ring is the day against the target you ticked in
**Targets**. Nothing is copied between them, so correcting a food's numbers
corrects every meal you ever logged it in — and nothing needs resetting at
midnight.

Under this page sit the databases: **Food log** is what you ate, **Foods** is
your own list with per-serving macros, **Targets** is what you are aiming at,
and **Weigh-ins** is the feedback — a calorie target is right when the weight
goes where you meant it to, and wrong when it does not, whatever the
arithmetic promised.
