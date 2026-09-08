# Budget Tracker

A ledger of transactions, a monthly limit per category, a calendar of bills.
Every total is summed from the rows when you look, so there is nothing to
recalculate and nothing to reset at the start of a month.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/budget.yaml` | `.cortex/schemas/budget.yaml` | date, amount, kind, category, account, payee, `bill` — a relation to the bills |
| `schemas/budget-limits.yaml` | `.cortex/schemas/budget-limits.yaml` | monthly_limit, bucket (need / want / saving), active |
| `schemas/budget-bills.yaml` | `.cortex/schemas/budget-bills.yaml` | amount, cycle, next_due, category, account, active, url |
| `index.md` | `collections/budget/_index.md` | views: Ledger, By category, Month by month, Categories over time, Calendar |
| `index/budget-limits.md` | `collections/budget-limits/_index.md` | views: Limits, Needs, wants, savings (board) |
| `index/budget-bills.md` | `collections/budget-bills/_index.md` | views: Upcoming, Calendar, By cycle |
| `templates/budget.md` | `collections/budget/_template-budget.md` | New row's shape for a transaction |
| `templates/budget-limits.md` | `collections/budget-limits/_template-budget-limits.md` | a limit whose page charts the spend against it |
| `templates/budget-bills.md` | `collections/budget-bills/_template-budget-bills.md` | a bill whose page lists its payments and a cancel-or-keep checklist |
| `seed/budget/*.md` | `collections/budget/` | three example rows: a weekly shop, a salary, a rent payment linked to its bill |
| `seed/budget-limits/*.md` | `collections/budget-limits/` | groceries, dining, subscriptions |
| `seed/budget-bills/*.md` | `collections/budget-bills/` | Rent, Music streaming |

The two extra databases nest under Budget in the sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install budget-tracker`).
2. **Open Budget** and log the last week from your bank statement with New
   row: a title, the amount (always positive), `kind`, `category`, `account`.
   Thirty seconds a row. The Ledger fills newest-first and the charts draw
   themselves.
3. **Set two limits and your bills.** In Budget limits, edit the three seeded
   rows or add one per category you actually overspend, with the monthly
   number. In Bills and subscriptions, add each recurring charge with its
   cycle and next due date. Delete the example rows when you have your own.

## How it works

- **The ledger is the only thing you type into.** Limits and bills are read
  against it; nothing is copied between databases. A month with no rows is a
  month with nothing spent.
- **Amounts are positive; `kind` carries the sign.** That is what lets Month
  by month stack income against spending, and it keeps you from typing minus
  signs on a phone. `transfer` is for money between your own accounts — it is
  excluded from the income-versus-spending chart so it does not count twice.
- **A limit is a page.** Its title is the category name; its body embeds a bar
  chart of that category's spend per month and the fifteen latest rows.
  Compare the current month's bar with `monthly_limit`: that is the budget check. `bucket` groups limits into
  needs, wants and savings if you follow the 50/30/20 split.
- **A bill is a page too.** Set a transaction's `bill` when you log the
  payment and it appears in the bill's Payments list, which is where you catch
  a price rise. `next_due` is the date you move forward when you pay.
- **Filters are plain text.** Every view is a few lines of YAML in the
  `_index.md`; a limit's chart is `filter: category == 'groceries' and kind ==
  'expense'`. To rename a category, change it in the schema, in the rows that
  use it, and in the matching limit's title; the views follow.

## Ideas

- Add a `merchant` view: table filtered `payee contains 'Supermarket'`.
- Track a savings target by filing transfers into savings under
  `category: savings` and giving it a limit — the bar becomes a goal rather
  than a ceiling.
- Put a `cortex-view` chart in your monthly review note:
  `source: collections/budget`, `type: chart`, `x: category`, `y: amount`,
  `agg: sum`, `chartType: bar`, `filter: kind == 'expense' and date >= '2026-09-01'`.
- Pair it with the Goals pack for the money goals the limits serve, and with
  the Weekly Review template for the five-minute reconcile.

## Agents and the terminal

- `cortex set collections/budget/coffee title=Coffee amount=3.2 kind=expense category=dining payee=Cafe`
  creates a row from the template with today's date and sets the rest.
- `cortex view budget --filter "category == 'dining' and kind == 'expense'" --sort 'date desc'`
  prints what a view shows; `--json` for a script.
- Over MCP, `create_note` with `dir: collections/budget` makes the row,
  `set_properties` fills in amount, kind and category, and `query_collection`
  reads the ledger back, so "I spent 12 on lunch" becomes one row without
  opening the app.

## Upgrading from 1.x

Version 1 was a single `budget` collection with a signed `amount` (negative
for spending) and a free-text `account`. Version 2 keeps the same folder and
adds `kind`, `payee` and `bill`, turns `account` into a select, and installs
the two extra collections. Existing rows keep working, but their amounts stay
negative until you flip them and set `kind: expense` — the charts sum what
they find. `cortex packs update` never touches a row you wrote.
