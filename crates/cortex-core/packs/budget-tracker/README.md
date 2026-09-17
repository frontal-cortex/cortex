# Budget Tracker

A finance dashboard on one page — buttons to log an expense, an income or a
transfer, this month's spent, earned and net, budgets as cards with a ring
each, expenses, income and transfers with their Recent, Weekly, Monthly,
Yearly and Chart tabs, a donut of where the money went, and every account's
balance. You log into three databases; everything else is computed from them
when you look, so there is nothing to recalculate and nothing to reset at the
start of a month.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `index.md` | `collections/budget/_index.md` | the dashboard page: buttons, this month's totals, budget cards, the Expenses / Income / Transfers tabs, donuts, account balances |
| `schemas/expenses.yaml`, `index/expenses.md` | `collections/expenses/` | date, amount, `category` → Categories, `account` → Accounts, payee, `bill`, `wish`; views Recent, Weekly, Monthly, Chart, By category, Calendar |
| `schemas/income.yaml`, `index/income.md` | `collections/income/` | date, amount, source, `account` → Accounts; views Recent, Monthly, Yearly, Chart |
| `schemas/transfers.yaml`, `index/transfers.md` | `collections/transfers/` | date, amount, `from_account` and `to_account` → Accounts, `wish`; views Recent, Monthly |
| `schemas/accounts.yaml`, `index/accounts.md` | `collections/accounts/` | kind, initial, active; computed `income`, `spent`, `moved_in`, `moved_out`, `balance`, `this_month`; views Balances, Cards, By kind |
| `schemas/categories.yaml`, `index/categories.md` | `collections/categories/` | monthly_budget, bucket, active; computed `spent`, `last_month`, `remaining`, `usage` and `last_month_usage` as rings; views This month, Last month, Budget check, Needs, wants, savings |
| `schemas/budget-bills.yaml`, `index/budget-bills.md` | `collections/budget-bills/` | amount, repeat, next_due, paid, category, account; computed `last_paid`, `total_paid`, `monthly`, `due_in` |
| `schemas/budget-wishlist.yaml`, `index/budget-wishlist.md` | `collections/budget-wishlist/` | price, priority, target; computed `put_by`, `paid`, `bought_on`, `left`, `saved`, `status` |
| `templates/*.md` | `collections/*/_template-*.md` | each database's new-row shape; account, category, bill and wish pages list their own rows |
| `seed/*/*.md` | `collections/*/` | four accounts, six categories, eight expenses, two salaries, three transfers, two bills, three wishes — dated relative to the day you install, so every ring, chart and balance has a shape straight away |

All seven databases nest under Budget in the sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install budget-tracker`).
   Look around: the example rows show what every ring, chart and balance does.
2. **Clear the examples** when you are ready for real data: **Clear data** on
   the pack's Marketplace page, or `cortex packs clear budget-tracker`. Every
   row in the seven databases goes to the trash (each one restorable); the
   dashboard, views and row templates stay.
3. **Add your accounts.** In Accounts, one row per account, with `initial` set
   to what it held on the day you start logging.
4. **Add your categories.** In Categories, one row per category, with
   `monthly_budget` on the ones you want to hold to a number.
5. **Log with the buttons.** New expense, New income and New transfer each open
   a row dated today: type the amount, pick the account (and for an expense,
   the category).
6. **Optional: a currency sign.** Amounts use the `currency` format with no
   sign. Pick Currency in a column's menu and type the unit, or add
   `unit: "€"` to `amount` in the schemas.

## How it works

- **A row's database is what it is.** An expense lives in Expenses, an income
  in Income, a transfer in Transfers. There is no `kind` to set, so a row can't
  say one thing and count as another.
- **A transfer has both ends.** `from_account` loses the amount and
  `to_account` gains it, and it is neither spending nor income. Paying off a
  credit card, moving money into savings and taking out cash are all
  transfers.
- **Balances are computed.** An account's `balance` is its `initial`, plus the
  income that names it, minus the expenses that name it, plus transfers in,
  minus transfers out. Nothing is copied into the account, so there is nothing
  to keep in step.
- **Budgets move with the calendar.** A category's `spent` sums its expenses
  dated this month, `last_month` the month before; `remaining` and the `usage`
  ring follow. On the 1st they move on without you touching anything.
- **Renaming is safe.** Rename an account or a category and every row that
  names it follows, so its balance and ring stay right. An account's, a
  category's, a bill's and a wish's own page lists its rows with `@this` — the
  page it sits on — so those lists follow the rename too.
- **A bill advances itself.** Tick `paid` and `next_due` moves forward one
  `repeat` cycle and `paid` clears, in the same row. Set `bill` on the expense
  that pays it and the bill knows `last_paid` and `total_paid`.
- **A wish tracks itself.** Set `wish` on a transfer to count the money as put
  aside, and on the expense that buys it to move it to Bought at what it
  really cost.

## Agents and the terminal

- `cortex set collections/expenses/lunch title=Lunch amount=12.5 'category=["Dining"]' 'account=["Checking"]'`
  creates an expense from the row template, dated today.
- `cortex set collections/transfers/savings title="To savings" amount=200 'from_account=["Checking"]' 'to_account=["Savings"]'`
  moves money between accounts.
- `cortex view accounts --view Balances` prints every balance, computed;
  `cortex view categories --view "Budget check"` prints the budgets, fullest
  first. Add `--json` for a script.
- Over MCP, `create_note` in `collections/expenses` and `set_properties` log a
  row, and `run_view` reads the same computed numbers the app shows.

## What is new in 4.0

Expenses, income and transfers are separate databases, as in Sentele's
Finance Tracker, instead of one ledger with a `kind`. In 3.x a row could carry
a destination account while its `kind` said income, and then count towards no
balance at all, with nothing on screen to say so. Now the database a row is in
decides what it is, and a transfer always has both ends.

- **Categories replace Budget limits.** A category is a row with its
  `monthly_budget`, and expenses relate to it, so its ring comes from the
  expenses filed under it rather than from a matching name.
- **The dashboard follows the template's layout**: buttons and budget cards on
  the left; Expenses, Income and Transfers with their tabs in the middle; the
  donuts and account balances on the right.
- **Income has its own views**, including a yearly list and a chart by source.
- **Renaming no longer breaks anything** (see How it works).

## Upgrading from 3.x

The new databases install beside your existing `budget` ledger, which is left
as it is: an update never moves or rewrites rows you wrote. To bring them
across, move each ledger row into the database its `kind` names —
`collections/expenses/`, `collections/income/` or `collections/transfers/` —
and then:

- delete `kind`;
- for an income, rename `category` to `source`;
- for a transfer, rename `account` to `from_account` and keep `to_account`.

Point `category` at the rows in Categories (they replace Budget limits), and
make sure every account a row names exists in Accounts. An agent with this
vault open can do the whole move in one pass.
