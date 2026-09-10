# Budget Tracker

A finance dashboard on one page — buttons to log a transaction, this month's
spent, earned and net, budgets as cards with a ring each, spending by month,
a donut of where it went, every account's balance — over one ledger, a
monthly limit per category, accounts with opening balances, and a calendar of
bills. Every number is computed from the rows when you look, so there is
nothing to recalculate and nothing to reset at the start of a month.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/budget.yaml` | `.cortex/schemas/budget.yaml` | date, amount, kind, category, `account` and `to_account` — relations to the accounts — payee, `bill` — a relation to the bills |
| `schemas/accounts.yaml` | `.cortex/schemas/accounts.yaml` | kind, initial, active; computed from the ledger: `income`, `spent`, `moved_in`, `moved_out`, `this_month`, `balance` |
| `schemas/budget-limits.yaml` | `.cortex/schemas/budget-limits.yaml` | monthly_limit, bucket (need / want / saving), active; computed: `spent`, `last_month`, `remaining`, `used` |
| `schemas/budget-bills.yaml` | `.cortex/schemas/budget-bills.yaml` | amount, repeat, repeat_mode, next_due, paid, category, account, active, url; computed: `last_paid`, `total_paid`, `monthly`, `due_in` |
| `index.md` | `collections/budget/_index.md` | the dashboard (buttons, tiles, budget cards, spending and income by month, the donut, account balances) above the views: Ledger, This month, By month, Summary, This month by category, By category, Month by month, Categories over time, Calendar |
| `index/accounts.md` | `collections/accounts/_index.md` | views: Balances (with a total), Cards, By kind |
| `index/budget-limits.md` | `collections/budget-limits/_index.md` | views: This month (the budget check), Needs, wants, savings (board) |
| `index/budget-bills.md` | `collections/budget-bills/_index.md` | views: Upcoming, Overdue, Per month, Calendar, By cycle |
| `templates/budget.md` | `collections/budget/_template-budget.md` | New row's shape for a transaction |
| `templates/accounts.md` | `collections/accounts/_template-accounts.md` | an account whose page lists its movements and charts them by month |
| `templates/budget-limits.md` | `collections/budget-limits/_template-budget-limits.md` | a limit whose page charts the spend against it |
| `templates/budget-bills.md` | `collections/budget-bills/_template-budget-bills.md` | a bill that advances when you tick `paid`, with its payment list and a cancel-or-keep checklist |
| `seed/budget/*.md` | `collections/budget/` | eleven example rows over the last five weeks: two weekly shops, a coffee, a bus pass, a streaming payment linked to its bill, two salaries, two rent payments linked to their bill, a transfer to savings and a cash withdrawal |
| `seed/accounts/*.md` | `collections/accounts/` | checking, savings, cash, with opening balances |
| `seed/budget-limits/*.md` | `collections/budget-limits/` | groceries, dining, subscriptions |
| `seed/budget-bills/*.md` | `collections/budget-bills/` | Rent (due in four weeks), Music streaming (three days overdue) |

The three extra databases nest under Budget in the sidebar. The seeds are dated
relative to the day you install, so This month, Overdue, Month by month and
the limits table all show something straight away.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install budget-tracker`).
2. **Open Budget** and log the last week from your bank statement with New
   row: a title, the amount (always positive), `kind`, `category`, `account`.
   Thirty seconds a row. The Ledger fills newest-first and the charts draw
   themselves.
3. **Set two limits and your bills.** In Budget limits, edit the three seeded
   rows or add one per category you actually overspend, with the monthly
   number; `spent`, `remaining` and `used` fill in from the ledger. In Bills
   and subscriptions, add each recurring charge with its `repeat` cycle and
   `next_due`. Delete the example rows when you have your own.
4. **Optional: a currency sign.** Amounts use the `currency` format with no
   sign. Add `unit: "€"` (or `$`, `£`) to `amount` in
   `.cortex/schemas/budget.yaml`, and to `monthly_limit`, `spent`, `remaining`
   and `last_month` in the limits schema and `amount`, `total_paid` and
   `monthly` in the bills schema — or pick Currency in a column's menu in the
   app and type the unit there.

## How it works

- **The ledger is the only thing you type into.** Limits and bills are read
  against it; nothing is copied between databases. A month with no rows is a
  month with nothing spent.
- **Amounts are positive; `kind` carries the sign.** That is what lets Month
  by month stack income against spending, and it keeps you from typing minus
  signs on a phone. `transfer` is for money between your own accounts — it is
  excluded from the income-versus-spending chart so it does not count twice.
- **This month means this month.** The ledger's This month views filter
  `date >= @month`; a limit's `spent` is a rollup over the ledger rows whose
  `category` equals the limit's title with `date >= @month and date <
  @month+1`, and `last_month` is the same a month back. On the 1st they all
  move on without you touching anything.
- **A limit is a row and a page.** In the table, `remaining` is
  `monthly_limit - spent` and `used` is the share as a bar, sorted worst
  first: that is the budget check. On the page, the chart is the category's
  history month by month. `bucket` groups limits into needs, wants and
  savings if you follow the 50/30/20 split.
- **A bill advances itself.** Each bill has `repeat` (weekly, monthly,
  quarterly, yearly), `repeat_mode: advance` and a `paid` checkbox. Tick
  `paid` in the app or over MCP and `next_due` moves forward one cycle and
  `paid` clears, in the same row. `due_in` counts the days to it; Overdue is
  the rows whose date passed unticked. `monthly` normalises the amount to a
  per-month cost so a yearly insurance and a weekly gym sit in one sorted
  list.
- **A bill knows its payments.** Set a transaction's `bill` when you log the
  payment: the bill's `last_paid` and `total_paid` come from those rows, and
  its page lists them, which is where you catch a price rise.
- **Filters are plain text.** Every view is a few lines of YAML in the
  `_index.md`; a limit's chart is `filter: category == 'groceries' and kind ==
  'expense'`. To rename a category, change it in the schema, in the rows that
  use it, and in the matching limit's title; the views and rollups follow.

## Ideas

- Add a `merchant` view: table filtered `payee contains 'Supermarket'`.
- Track a savings target by filing transfers into savings under
  `category: savings` and giving it a limit — `used` becomes a goal bar
  rather than a ceiling.
- A "last 90 days" chart in your quarterly note: `source:
  collections/budget`, `type: chart`, `x: category`, `y: amount`, `agg: sum`,
  `chartType: bar`, `filter: kind == 'expense' and date >= @today-90`.
- Pair it with the Goals pack for the money goals the limits serve, and with
  the Weekly Review template for the five-minute reconcile.

## Agents and the terminal

- `cortex set collections/budget/coffee title=Coffee amount=3.2 kind=expense category=dining payee=Cafe`
  creates a row from the template with today's date and sets the rest.
- `cortex view budget --filter "category == 'dining' and date >= @month" --sort 'date desc'`
  prints what a view shows; `--json` for a script. The computed columns
  (`spent`, `remaining`, `used`, `monthly`, `due_in`) are filled in by the
  app and by MCP's `run_view`; `cortex view` prints the stored properties.
- Over MCP, `create_note` with `dir: collections/budget` makes the row,
  `set_properties` fills in amount, kind and category, and `query_collection`
  reads the ledger back, so "I spent 12 on lunch" becomes one row without
  opening the app. Ticking a bill's `paid` through `set_cell` advances it the
  same way the app does; `cortex set paid=true` writes the file directly and
  does not.

## What is new in 3.0

- **The Budget page is a dashboard.** Three buttons (New expense, New income,
  New transfer) make a row with the kind and today's date filled in and open
  it; tiles show this month's spent, earned and net; the budgets are cards
  with a ring each; spending and income are folded by month with a total
  under each; a donut shows where this month went; every account shows its
  balance. It is all `cortex-view` blocks and three `cortex-button` blocks in
  a `::: columns` layout at the top of `collections/budget/_index.md`, so it
  is yours to rearrange.
- **Accounts.** `collections/accounts/`: one row per account with an opening
  balance; income, spending, transfers in and out and the balance are rollups
  and a formula over the ledger. The ledger's `account` is now a relation to
  it, and a transfer is one ledger row with `account` (from) and `to_account`
  (to) — no separate transfers database, nothing counted twice.
- **Rings.** A limit's `used` shows as a ring instead of a bar.

## Upgrading from 2.x

`account` in the ledger and in bills was a select with the options
`checking`, `savings`, `credit`, `cash`; it is a relation to the new
`accounts` collection now, whose seeded rows carry exactly those titles, so
existing rows keep working as they are. To see balances, set each account's
`initial` to what it held on the day of your first ledger row. Add
`to_account` to any transfer you logged before (the ledger's row template
now includes it). The dashboard replaces the old page body — if you wrote
notes on the Budget page, they are kept: update keeps a file you edited and
tells you so; copy the new `_index.md` body in by hand if you want the
dashboard too.

## Upgrading (older)

**From 2.0.** Bills renamed `cycle` to `repeat` (same options) so the app's
recurrence reads it, and added `repeat_mode` and `paid`. On an existing
vault, rename `cycle:` to `repeat:` in each bill's frontmatter and add
`repeat_mode: advance` and `paid: false`; until you do, those bills show in
the views but do not advance. The computed properties need no migration —
they appear as soon as the new schemas are in place.

**From 1.x.** Version 1 was a single `budget` collection with a signed
`amount` (negative for spending) and a free-text `account`. Version 2 keeps
the same folder and adds `kind`, `payee` and `bill`, turns `account` into a
select, and installs the two extra collections. Existing rows keep working,
but their amounts stay negative until you flip them and set `kind: expense` —
the charts sum what they find. `cortex packs update` never touches a row you
wrote.
