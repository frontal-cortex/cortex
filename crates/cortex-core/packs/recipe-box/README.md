# Recipe Box

Recipes, a meal plan and a grocery list: three collections that work as one
kitchen, all plain Markdown, with the counts between them worked out on read.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/recipes.yaml` | `.cortex/schemas/recipes.yaml` | course, cuisine, main, diet, difficulty, prep_minutes, cook_minutes, servings, rating (stars), status, source, freezes, and five computed: total_minutes, times_cooked, last_cooked, next_planned, to_buy |
| `schemas/meals.yaml` | `.cortex/schemas/meals.yaml` | date, slot, recipe (a relation to the recipes), cooked |
| `schemas/groceries.yaml` | `.cortex/schemas/groceries.yaml` | aisle, quantity, bought, recipe |
| `index.md` | `collections/recipes/_index.md` | views: Cookbook (gallery), By course (board), Quick dinners, Rotation, To try, All |
| `index/meals.md` | `collections/meals/_index.md` | views: Plan (calendar), Today, This week, By slot (board), Cooked per week (chart) |
| `index/groceries.md` | `collections/groceries/_index.md` | views: To buy, By aisle (board), All |
| `templates/recipes.md` | `collections/recipes/_template-recipes.md` | New row's shape: ingredient checklist, numbered method, notes, a live cook log |
| `templates/meals.md` | `collections/meals/_template-meals.md` | a planned meal: date, slot, recipe, `cooked`, room for how it went |
| `templates/groceries.md` | `collections/groceries/_template-groceries.md` | an item: aisle, quantity, `bought`, the recipe it is for |
| `seed/recipes/*.md` | `collections/recipes/` | three recipes: a weeknight pasta, overnight oats, a curry still to try |
| `seed/meals/*.md` | `collections/meals/` | four meals: the pasta a week ago (cooked), oats this morning (cooked), the pasta tonight, the curry in two days |
| `seed/groceries/*.md` | `collections/groceries/` | three items for the pasta, one already bought |

Meals and Groceries nest under Recipes in the sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install recipe-box`).
2. **Open Recipes** and add three things you already cook: New row, a title,
   the ingredients as a checklist, the method as steps. Set `course` and the
   two minute fields and they start showing up in Quick dinners.
3. **Plan tonight.** Open Meals, New row, pick the recipe, leave the date as
   today. It is in Today and on the Plan calendar; tick `cooked` after
   dinner.

Then replace the seeded rows with your own.

## How it works

**Recipes** is the cookbook. Each view answers one question:

| View | Question |
|---|---|
| Cookbook | What have I got? Cards with cover images; set `cover:` on a row. |
| By course | Breakfast, lunch, dinner, dessert… a column per `course`. |
| Quick dinners | What can I make tonight in half an hour? Dinners whose `total_minutes` is 30 or under, fastest first, with how many items are still `to_buy`. A recipe missing either minute field has no total and stays out. |
| Rotation | What have I not made in a while? Keepers with the longest gap since `last_cooked` at the top, and when each is `next_planned`. |
| To try | What did I clip and never cook? `status: to try`, with the `source` link and the date it is `next_planned` for, if you have put it on the plan. |
| All | The whole table, best rated first. |

The properties you type: `course` and `cuisine` are what you browse by; `main`
(chicken, beef, fish, beans, tofu, pasta…) is what you actually decide dinner
by; `diet` is a multi-select so one dish can be vegan and gluten-free;
`difficulty`, `prep_minutes`, `cook_minutes` and `servings` are the numbers a
recipe card shows; `rating` is 1 to 5, drawn as stars; `status` runs to try →
tried → keeper → retired, so a recipe you would not cook again stays in the
archive without cluttering the views; `source` is where it came from;
`freezes` marks the ones worth doubling.

The properties you do not type — computed every time a view is read, never
written into the file:

- `total_minutes` is prep plus cook, empty if either is missing.
- `times_cooked` counts the meals pointing at this recipe with `cooked`
  ticked; `last_cooked` is the latest of their dates; `next_planned` is the
  earliest unticked meal from today on.
- `to_buy` counts the grocery items for this recipe that are not `bought`.

**Meals** is the plan: one row per meal with a `date`, a `slot` and a
`recipe`. Plan is the calendar; Today is what is on today, breakfast first;
This week is Monday to Sunday in order and By slot is the same week as a
board, a column per slot; Cooked per week is a bar chart of ticked meals by
week, one series per slot. Ticking `cooked` keeps the row where it is and
feeds the chart and the recipe's counts. Every recipe's page ends with a cook
log — a live table of the meals that point at it.

**Groceries** is the list. One row per item with an `aisle`, a `quantity`, a
`bought` box and the `recipe` it is for. To buy is sorted by `aisle` in the
order the options are declared in the schema — reorder them to match your
shop and you walk it once — with the `bought` box in the row so you tick as
you go; By aisle is the same list as a board. Nothing is deleted: untick
`bought` on a staple and it is back on the list.

## Ideas

- Give the recipes you cook every week a `cover:` image and the Cookbook view
  becomes the menu you show the family.
- Add a view to Recipes with `filter: "freezes == true"` for batch-cooking
  Sundays, `filter: "diet contains 'vegan'"` when someone is visiting, or
  `filter: "to_buy == 0 and status == 'keeper'"` for what you can cook from
  the cupboard tonight.
- Plan the week from This week or the Plan calendar, then open each recipe
  and add its missing ingredients to Groceries with New row. The `recipe`
  relation on the item tells you at the shelf what it was for, and the
  recipe's `to_buy` tells you when you are done.
- From a terminal, `cortex set collections/meals/friday-curry recipe+="Chicken tikka masala"`
  creates the meal from the template if it does not exist and links the
  recipe; `cortex set collections/meals/friday-curry cooked=true` ticks it.

## Upgrading

From 2.0: `rating` was a select of star strings and is now a number from 1 to
5 shown as stars, so a row carrying `"★★★★"` needs `4` instead — the only
edit the update asks of you. The computed properties are added to the
recipes schema and existing rows pick them up as they are. The meals views
changed shape: Upcoming became Today and This week, and the board and the
chart now use the current week; Quick dinners is now on total minutes rather
than cook minutes alone. Views live in `_index.md`, so if you edited yours
the update leaves them alone.

From 1.x: version 1 had `cuisine`, `prep_minutes` and `rating`. Version 2
keeps those names, so existing rows still work; the update adds the other
properties and the two extra collections. The `asian` cuisine option is
replaced by `chinese`, `japanese` and `thai`, so rows carrying it need a new
pick. The row template's "Steps" heading is now "Method" — old rows keep
their heading.
