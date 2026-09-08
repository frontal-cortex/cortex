# Recipe Box

Recipes, a meal plan and a grocery list: three collections that work as one
kitchen, all plain Markdown.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/recipes.yaml` | `.cortex/schemas/recipes.yaml` | course, cuisine, main, diet, difficulty, prep_minutes, cook_minutes, servings, rating, status, source, freezes |
| `schemas/meals.yaml` | `.cortex/schemas/meals.yaml` | date, slot, recipe (a relation to the recipes), cooked |
| `schemas/groceries.yaml` | `.cortex/schemas/groceries.yaml` | aisle, quantity, bought, recipe |
| `index.md` | `collections/recipes/_index.md` | views: Cookbook (gallery), By course (board), Quick dinners, To try, All |
| `index/meals.md` | `collections/meals/_index.md` | views: Plan (calendar), Upcoming, By slot (board), Cooked per week (chart) |
| `index/groceries.md` | `collections/groceries/_index.md` | views: To buy, By aisle (board), All |
| `templates/recipes.md` | `collections/recipes/_template-recipes.md` | New row's shape: ingredient checklist, numbered method, notes, a live cook log |
| `templates/meals.md` | `collections/meals/_template-meals.md` | a planned meal: date, slot, recipe, `cooked`, room for how it went |
| `templates/groceries.md` | `collections/groceries/_template-groceries.md` | an item: aisle, quantity, `bought`, the recipe it is for |
| `seed/recipes/*.md` | `collections/recipes/` | three recipes: a weeknight pasta, overnight oats, a curry still to try |
| `seed/meals/*.md` | `collections/meals/` | two meals on today's date, one already cooked |
| `seed/groceries/*.md` | `collections/groceries/` | three items for the pasta, one already bought |

Meals and Groceries nest under Recipes in the sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install recipe-box`).
2. **Open Recipes** and add three things you already cook: New row, a title,
   the ingredients as a checklist, the method as steps. Set `course` and
   `cook_minutes` and they start showing up in Quick dinners.
3. **Plan tonight.** Open Meals, New row, pick the recipe, leave the date as
   today. It is on the Plan calendar and at the top of Upcoming; tick `cooked`
   after dinner.

Then replace the seeded rows with your own.

## How it works

**Recipes** is the cookbook. Each view answers one question:

| View | Question |
|---|---|
| Cookbook | What have I got? Cards with cover images; set `cover:` on a row. |
| By course | Breakfast, lunch, dinner, dessert… a column per `course`. |
| Quick dinners | What can I make tonight in half an hour? Dinners with `cook_minutes` filled in and 30 or under, fastest first. |
| To try | What did I clip and never cook? `status: to try`, with the `source` link. |
| All | The whole table, best rated first. |

The properties: `course` and `cuisine` are what you browse by; `main` (chicken,
beef, fish, beans, tofu, pasta…) is what you actually decide dinner by;
`diet` is a multi-select so one dish can be vegan and gluten-free; `difficulty`,
`prep_minutes`, `cook_minutes` and `servings` are the numbers a recipe card
shows; `rating` is your verdict; `status` runs to try → tried → keeper →
retired, so a recipe you would not cook again stays in the archive without
cluttering the views; `source` is where it came from; `freezes` marks the
ones worth doubling.

**Meals** is the plan: one row per meal with a `date`, a `slot` and a
`recipe`. The Plan calendar is the week; Upcoming is the same list in date
order and drops a meal the moment you tick `cooked`; Cooked per week is a bar
chart of ticked meals, bucketed by week; By slot is the unticked ones as a
board, a column per slot. Every recipe's page ends with a cook
log — a live table of the meals that point at it — so "when did I last make
this" is answered on the recipe itself.

**Groceries** is the list. One row per item with an `aisle`, a `quantity`, a
`bought` box and the `recipe` it is for. To buy is sorted by aisle so you walk
the shop once, with the `bought` box in the row so you tick as you go; By
aisle is the same list as a board. Nothing is deleted:
untick `bought` on a staple and it is back on the list.

## Ideas

- Give the recipes you cook every week a `cover:` image and the Cookbook view
  becomes the menu you show the family.
- Add a view to Recipes with `filter: "freezes == true"` for batch-cooking
  Sundays, or `filter: "diet contains 'vegan'"` when someone is visiting.
- Plan the week from the Plan calendar, then open each recipe and add its
  missing ingredients to Groceries with New row. The `recipe` relation on the
  item tells you at the shelf what it was for.
- From a terminal, `cortex set collections/meals/friday-curry recipe+="Chicken tikka masala"`
  creates the meal from the template if it does not exist and links the
  recipe; `cortex set collections/meals/friday-curry cooked=true` ticks it.

## Upgrading from 1.x

Version 1 had `cuisine`, `prep_minutes` and `rating`. Version 2 keeps those
names, so existing rows still work; the update adds the other properties and
the two extra collections. The `asian` cuisine option is replaced by
`chinese`, `japanese` and `thai`, so rows carrying it need a new pick. The
row template's "Steps" heading is now "Method" — old rows keep their heading.
