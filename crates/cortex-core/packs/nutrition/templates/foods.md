---
title: "{{title}}"
type: note
tags: []
serving: "100 g"
calories: 0
protein: 0
carbs: 0
fat: 0
fibre: 0
kind: protein
favourite: false
width: full
created: "{{date}}"
---

<!-- Copy the numbers off the packet for exactly one serving, then say what a serving is. Per 100 g is the easiest: 150 g is then 1.5 servings. -->

## Eat this

```cortex-button
label: Breakfast
action: add-row
collection: food-log
values: {date: "{{today}}", meal: breakfast, food: "{{this}}", servings: 1, title: "{{this}}"}
```

```cortex-button
label: Lunch
action: add-row
collection: food-log
values: {date: "{{today}}", meal: lunch, food: "{{this}}", servings: 1, title: "{{this}}"}
```

```cortex-button
label: Dinner
action: add-row
collection: food-log
values: {date: "{{today}}", meal: dinner, food: "{{this}}", servings: 1, title: "{{this}}"}
```

```cortex-button
label: Snack
action: add-row
collection: food-log
values: {date: "{{today}}", meal: snack, food: "{{this}}", servings: 1, title: "{{this}}"}
```

```cortex-view
source: collections/foods
type: stats
stats:
  - {label: Times logged, source: collections/food-log, agg: count, filter: "food == @this"}
  - {label: Last eaten, source: collections/food-log, agg: max, field: date, filter: "food == @this"}
  - {label: Servings, source: collections/food-log, agg: sum, field: servings, filter: "food == @this", format: decimal}
  - {label: Calories from it, source: collections/food-log, agg: sum, field: calories, filter: "food == @this and date >= @today-29", format: integer}
  - {label: Protein from it, source: collections/food-log, agg: sum, field: protein, filter: "food == @this and date >= @today-29", format: integer}
```

## Every time you have eaten it

```cortex-view
source: collections/food-log
type: table
columns: [date, meal, servings, calories, protein, fibre]
filter: food == @this
sort: [date desc]
limit: 30
```

## Notes

Where you buy it, the brand these numbers came from, how you cook it.
