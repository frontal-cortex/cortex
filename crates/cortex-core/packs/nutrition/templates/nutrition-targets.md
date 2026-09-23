---
title: "{{title}}"
type: note
tags: []
calories: 2200
protein: 140
fibre: 30
carbs: 230
fat: 70
active: false
width: full
created: "{{date}}"
---

<!-- Tick `active` on the one row the dashboard should measure you against. Keep the others for the days that are meant to be different. -->

## This target against what you have been eating

```cortex-view
source: collections/nutrition-targets
type: stats
stats:
  - {label: Fortnight calories, source: collections/food-log, agg: sum, field: calories, filter: "date >= @today-13", hidden: true}
  - {label: Fortnight protein, source: collections/food-log, agg: sum, field: protein, filter: "date >= @today-13", hidden: true}
  - {label: Fortnight fibre, source: collections/food-log, agg: sum, field: fibre, filter: "date >= @today-13", hidden: true}
  - {label: Calories a day, expr: "round(fortnight_calories / 14)", format: integer}
  - {label: Protein a day, expr: "round(fortnight_protein / 14)", format: integer}
  - {label: Fibre a day, expr: "round(fortnight_fibre / 14)", format: integer}
  - {label: Weight now, source: collections/weigh-ins, agg: avg, field: weight, filter: "date >= @today-6", format: decimal}
  - {label: Weight a month ago, source: collections/weigh-ins, agg: avg, field: weight, filter: "date >= @today-34 and date < @today-27", format: decimal}
```

Two weeks of eating and where the weight went, so a target can be set against
what you actually do rather than what you meant to.

## Where these numbers come from

- **Protein.** The usual rule is grams per kilo of bodyweight, not a share of
  calories — protein does not scale with how much you eat, and a percentage
  split quietly cuts it exactly when you are dieting and need it most. Morton's
  2018 meta-analysis puts the point of no further benefit around 1.6 g/kg;
  the ISSN's position stand gives 1.4–2.0 g/kg for people who train, and more
  while eating at a deficit. At 87 kg, 1.6 g/kg is 140 g.
- **Fibre.** 14 g per 1000 kcal is the intake the US guidelines are built on —
  about 30 g at 2200 kcal. Most people eat half that, which is why it is worth
  putting a number on at all.
- **Calories.** 2000–2200 is the middle of the range for an adult who moves a
  normal amount; the honest way to set yours is to log for two weeks without
  changing anything, read the average above, and adjust from there. To lose
  weight, take 300–500 kcal off that average — about 0.5 kg a week — rather
  than off a number from a calculator.
- **Carbs and fat** are what is left once calories and protein are set. Keep
  fat above roughly 0.6 g/kg and put the rest wherever you eat it more
  happily; the split between them changes very little that the calorie total
  has not already changed.

## Why this one

What this target is for, and what would make you change it.
