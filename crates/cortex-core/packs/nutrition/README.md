# Nutrition

Calories, protein and fibre against a target you set, from a food list you
build once. A macro is typed in one place — the food — and every meal you log
it in reads from there, so correcting a food corrects your whole history.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `index.md` | `collections/nutrition/_index.md` | the dashboard: three rings for the day, what is left of each, today's rows and their totals, seven-day averages, a fortnight of days as bars, the weekly weight line, and where the protein came from |
| `schemas/foods.yaml`, `index/foods.md` | `collections/foods/` | serving, calories, protein, carbs, fat, fibre, kind, favourite; computed `times_logged`, `last_eaten`, `logged_30d`; views Most eaten, Favourites, By kind, Protein per serving, Catalogue |
| `schemas/food-log.yaml`, `index/food-log.md` | `collections/food-log/` | date, meal, `food` → Foods, servings, and `own_calories`/`own_protein`/`own_fibre` for what someone else cooked; computed `calories`, `protein`, `carbs`, `fat`, `fibre`; views Today, This week, By meal, Calories per day, Protein per day |
| `schemas/nutrition-targets.yaml`, `index/nutrition-targets.md` | `collections/nutrition-targets/` | calories, protein, fibre, carbs, fat, bodyweight, `active`; the row with `active` ticked is the one the dashboard measures you against |
| `schemas/weigh-ins.yaml`, `index/weigh-ins.md` | `collections/weigh-ins/` | date, weight, note; views Recent, Trend, Every day |
| `templates/*.md` | `collections/*/_template-*.md` | the shape of a new food, row, target and weigh-in — a food's page carries four buttons that log it, its own history, and the numbers it has put into you |
| `seed/*/*.md` | `collections/*/` | twenty-seven foods with macros from USDA FoodData Central, three days of eating, a fortnight of weigh-ins, and one target row, so nothing is empty on the first day |

All four databases nest under Nutrition in the sidebar.

## How to log

1. **Press a meal** on the dashboard — Breakfast, Lunch, Dinner, Snack. A row
   opens, dated today; pick the food and the servings.
2. **Or open a food** you eat often and press the meal there: one press, one
   serving, logged, no page to fill in.
3. **`servings` is the multiplier.** 1 is one serving as that food defines it.
   A food written per 100 g logs 150 g as `1.5`; half a portion is `0.5`.
4. **Someone else cooked it?** Leave `food` empty and put what you know into
   `own_calories`, `own_protein` and `own_fibre`. They are used only when
   there is no food to read from.
5. **The same breakfast every day** is one food, not five: make a food of the
   whole bowl with `kind: meal` and the totals of it, and log one row. Do not
   then log its parts as well — that is the one way to count a meal twice.

## The numbers

- A logged row is the food's macros times the servings.
- A day is its rows added up; the rings are the day against the `active`
  target row.
- The seven-day averages divide by seven, not by the days you logged — a week
  with two unlogged days reads low, which is the honest answer. The bars show
  which days those were.
- Nothing is stored: every total is computed when you look at it, so nothing
  needs resetting at midnight and no history is ever recalculated behind you.

## Choosing targets

The shipped row is 2200 kcal, 140 g protein and 30 g fibre — a starting point,
not a prescription. The reasoning, with sources, is on the target's own page.
The short version: protein in grams per kilo of bodyweight (1.6 g/kg is the
usual figure, 1.4–2.0 the usual range) rather than as a share of calories;
fibre at roughly 14 g per 1000 kcal; and calories set from two weeks of your
own logging rather than from a calculator.

## Worth knowing

- **Raw or cooked** matters: 100 g of cooked chicken is not 100 g of raw
  chicken. Say which in the food's title, and weigh it the same way every time.
- **Correcting a food rewrites history.** Because a row reads the food rather
  than copying it, fixing a wrong macro fixes every meal it appears in. That is
  usually what you want; it does mean a food's numbers are not a record of what
  you believed on the day.
- **Foods are matched by title.** Renaming a food in the app carries its rows
  with it; renaming it by hand in the file does not.
- **Five numbers, no more.** Calories, protein, carbs, fat, fibre. Trackers
  that ship twenty nutrients end up with eighteen empty columns.
