# Finance tracker — what the best one does, and the generic work that gets us there

The Budget Tracker pack is a ledger with limits and bills: honest, computed,
and flat. The finance trackers people actually keep open in Notion are
dashboards: a one-glance page with buttons to log a transaction, account
balances, this month's spend per category with a ring filling up, a donut
of where the money went, and the raw tables tucked one page down. This
document takes one such template apart, maps every piece to what Cortex
can render today, and lays out the work that closes the gap — as
capabilities any template can use (layout, actions, period grouping, KPI
cards, chart types), not as finance code.

Status 2026-09-10: plan. Nothing in sections 4–6 is built.

Source material: the page you installed (`app.notion.com/p/Finance-Tracker-2dc9…`)
is in your own workspace with public access off, so it cannot be read from
outside a logged-in session — publish it (Share → Publish) if you want your
exact copy compared. Its title matches the marketplace template **Finance
Tracker by Chris (Sentele)**, whose public preview was read block by block
through Notion's page-chunk API (`broad-snowman.notion.site/Finance-Tracker-1705…`),
together with Notion's own **Personal Finance Tracker** (4.85★, 2 000+
ratings) for a second reference. Property names, formulas, view settings
and automations below are verbatim from those records.

---

## 1. What the template is

### 1.1 Layout — one dashboard page, three columns

```
┌──────────── 21% ────────────┐ ┌──────────────── 54% ────────────────┐ ┌──────── 25% ────────┐
│ [banner: Quick add]         │ │ [banner: Expenses]                  │ │ [banner: Overview]   │
│ [button] New Income         │ │ Expenses ▸ Recent · Weekly ·        │ │ Chart: Expenses      │
│ [button] New Expense        │ │           Monthly · Chart           │ │   donut by Category  │
│ [button] New Transfer       │ │   (table, 10 rows, newest first)    │ │ Chart: Income        │
│ [banner: Budgets]           │ │ [banner: Income]                    │ │   donut by Source    │
│ Categories ▸ This Month ·   │ │ Incomes ▸ Recent · Monthly ·        │ │ [banner: Accounts]   │
│   Last Month  (gallery,     │ │           Yearly · Chart            │ │ Accounts (gallery:   │
│   small cards: budget,      │ │ [banner: Transfers]                 │ │   name + "Current    │
│   spent, Usage ring)        │ │ Transfers ▸ Recent · Monthly (list) │ │   Balance: $1,234")  │
│ ▸ Database (sub-page with   │ │                                     │ │                      │
│   the five raw tables)      │ │                                     │ │                      │
└─────────────────────────────┘ └─────────────────────────────────────┘ └──────────────────────┘
```

Every database on the dashboard is a *linked view* with its own visible
properties, sort and (for lists) date grouping; the databases themselves
live on a child page called **Database**, in a single column, as plain
tables. Section titles are images, not headings. A footer credits the
author.

### 1.2 Data model — five databases

| Database | Properties | Computed |
|---|---|---|
| **Accounts** | Account (title), Initial Amount ($) | relations to Incomes, Expenses, Transfers (as From and as To); rollups Total income, Total Expenses, Total TransferIn, Total TransferOut (sums); **Balance** = `Initial + income − expenses + in − out`; **Balance Text** = `"Current Balance: ".style("b") + Balance.formatNumber("usd")` |
| **Categories** | Category (title), Monthly Budget ($) | relation to Expenses; **Expense This Month** = sum over Expenses of their own "this month" formula; **Expense Last Month** = `Expenses.filter(Date in last month).map(Amount).sum()`; **Usage** = `round(this / budget · 100) / 100`, shown as a **ring** (percent, max 1); Usage Last Month likewise |
| **Expenses** | Expense (title), Amount ($), Date, Account (rel), Category (rel) | Expense This Month = `if(month(now) == month(Date), Amount, 0)` |
| **Incomes** | Income (title), Amount ($), Date, Source (select: Salary, Ecommerce, Affiliates, Digital Products, Real Estate), Accounts (rel) | — |
| **Transfers** | Transactions (title), Date, Amount ($), From Account (rel), To Account (rel) | — |

### 1.3 Views, exactly as configured

| Where | View | Type | Settings |
|---|---|---|---|
| Expenses | Recent | table | sort Date desc, **first-load limit 10**, shows Expense, Amount, Account, Date |
| Expenses | Weekly / Monthly | list | sort Date desc, **grouped by Date by day / by month**, hide empty groups |
| Expenses | Chart | chart | **column, x = Date bucketed by month, y = sum(Amount), stacked by Category (a relation)** |
| Incomes | Recent / Monthly / Yearly / Chart | table / list / list / chart | same shape; Yearly groups by year; chart stacked by Source (a select) |
| Transfers | Recent Transfers / Monthly | list | grouped by month |
| Categories | This Month / Last Month | gallery | **small cover**, cards show Category, Expense This Month, Monthly Budget, Usage (ring) |
| Overview | Expenses | chart | **donut** by Category, sum(Amount), labels = name, legend hidden, height medium |
| Overview | Income | chart | donut by Source, labels = name and value |
| Overview | Accounts | gallery | small cover, cards show Account and Balance Text |

### 1.4 Buttons — three automations

**New Income**, **New Expense**, **New Transfer**: each is a Notion button
whose automation adds a page to the matching database with preset
properties and opens it. That is the template's whole capture story: one
click, type an amount, done.

### 1.5 Notion's own template, for contrast

Four databases: **Income** and **Expenses** (Source, Amount, Tags select,
Date, a relation to a **Month**), **Total Savings** — one row per month
with rollups Total Monthly Income / Expenses, a formula Monthly Net, and
three *formatted text* formulas (`"Net: $" + format(round(Monthly Net))`)
so the gallery cards read as KPI tiles — and a **Finance Dashboard**, the
new `dashboard` view type (a widget layout Notion stores separately; the
public API does not expose it). Views are Q1–Q4 tables grouped by the Month
relation, with a **sum footer** on Amount, and Q1–Q4 galleries of the month
cards filtered by name. It models periods as rows because Notion has no
period grouping with per-group totals; Cortex does not need that.

### 1.6 What makes it good, in one list

1. Capture is one click and one number (the buttons).
2. Everything on the dashboard is *this month* without anyone editing a filter.
3. Money has a home: accounts with balances that reconcile income, spend and transfers.
4. Spend against budget is a picture (rings), not a table.
5. Where the money went is a donut; how it moved over time is stacked columns.
6. Recent-first, short lists; the long tables are one click away.
7. It looks composed: columns, banners, consistent card sizes.

---

## 2. What Cortex can do today

The data model is buildable this afternoon; the presentation is not.

| Template piece | Cortex today | Where |
|---|---|---|
| Five related databases | done — collections with `relation` properties | `schema.rs` |
| Balance = initial + rollups with signs | done — reverse rollups (`from` + `relation`) and a `formula` | `data.rs` `apply_rollups`, `formula.rs` |
| "This month" per category | done, simpler than Notion — a rollup with `where: date >= @month` instead of a per-row formula plus a filtered `map().sum()` | Budget pack `budget-limits.yaml` |
| Last month | done — `where: date >= @month-1 and date < @month` | same |
| Usage as a percent | done — `format: percent`; as a **ring**: missing (only `format: progress`, a bar) | `schema.rs` formats |
| Currency | done — `format: currency`, `unit: "$"` | |
| Text formula "Current Balance: **$1,234**" | missing `format`/`format_number`; not needed once cards show a labelled currency value | `formula.rs` |
| Recent (10 rows, newest first) | done — `limit: 10`, `sort: [date desc]`; no "show all" affordance | `Query.limit` |
| List grouped by day / month / year | **missing** — `group:` folds a table by a property's *value*; no date bucketing outside charts | `DataTable` group |
| Column chart by month stacked by category | done — `chart` with `bucket: month`, `series: category` | `run_chart` |
| Donut / pie | **missing** — `chartType` is `line` or `bar` | `MiniChart` |
| Gallery of small computed cards | partial — gallery shows a cover or an initial, then three fields; no compact / cover-less variant, no emphasis | `GalleryView` |
| Sum footer | done — `summary: {amount: sum}` | `summarize` |
| Dashboard with three columns | **missing** — no columns block | parity §1 "Columns: missing, L" |
| Section banners / images | done — images in notes | |
| Buttons that add a preset row | **missing** — no button block; `+ New` seeds from the view's filter only | parity §1 "Button block: missing, M" |
| Linked views with their own settings | partial — a `cortex-view` fence is a private view over a collection (own columns, filter, sort, limit); a `cortex-views` fence shows the collection's saved tabs | `CortexViewBlock`, `CollectionViewsBlock` |
| Child page holding the raw tables | done — collection pages, nested in the sidebar under a parent | |
| Q1–Q4 by name | not needed — `date within` / `@month` filters; a quarter word is missing (`@quarter`) | `placeholders.rs` |
| Period rows (Total Savings) | not needed — grouping with per-group summaries replaces month rows | |

So the gap is five presentation capabilities and one formula convenience,
every one of which other templates are already asking for.

---

## 3. The gaps, as generic capabilities

Each item: what the finance dashboard needs, who else needs it, the design
under the north star (files are truth, plain Markdown, keyboard, agents,
palette), and an effort estimate.

### 3.1 Columns — a layout block

**Needs:** the dashboard is three columns; every "dashboard" template in
Notion is (habits, projects, CRM, weekly review, second brain home pages).
**Also for:** Habit Tracker (streaks beside the grid), Project Tracker
(milestones beside tasks), any note that puts a chart next to a list.

**Design.** A fenced container that degrades to readable Markdown:

```markdown
::: columns 1 2 1
Left column: any blocks.
:::
Middle column, twice as wide.
:::
Right column.
::: end
```

`:::` directive fences are the closest thing to a convention (Markdoc,
Docusaurus, remark-directive, several Obsidian plugins); GitHub shows the
`:::` lines as text and the content in order, which is the right fallback.
Widths are ratios, optional; on a narrow window (or `data-viewport` phone)
columns stack. Editor: a `columnList` block spec rendering BlockNote's
multi-column support (`@blocknote/xl-multi-column`) with the fence written
at the load/save boundary like callouts and math. Publish: CSS grid.
Agents: the fence is plain text they can write.
**Effort: L** (the roadmap's rating; the boundary code is the known
pattern, the editor package is new).

### 3.2 Actions — a button block

**Needs:** New Income / New Expense / New Transfer. **Also for:** "Log
today" (habits), "Add task to Inbox", "New meeting note", "Start weekly
review", "Open the Board", "Mark bill paid".

**Design.** A fenced block, YAML inside, one action:

````markdown
```cortex-button
label: New expense
action: add-row
collection: expenses
values: {kind: expense, date: "{{today}}"}
open: true
```
````

Actions, each already a command the palette or CLI has: `add-row`
(collection, `values`, optional `template`, `open`), `open` (a note, a
collection, a view by name), `log` (tracker item for today), `set` (a
property on the current row — "Mark paid"), `url`. Buttons render as a
row of pills in the accent colour, keyboard-reachable, and appear in the
command palette by label while the note is open, so a button is also a
keystroke. The CLI and MCP gain nothing new: each action maps to an
existing operation (`cortex new`, `cortex set`, `cortex tracker --log`),
and `AGENTS.md` says so. Nothing runs on a timer; a button is a person
pressing it. **Effort: M.**

### 3.3 Period grouping — group table, list and board by date buckets

**Needs:** Weekly / Monthly / Yearly lists with per-group totals; that is
also what Notion's month-row database is a workaround for. **Also for:**
Journal (by week), Tasks done (by week), Reading log (by month), Meetings
(by week), any log.

**Design.** `group:` already takes a property; it gains a bucket:

```yaml
group: date
bucket: month        # day | week | month | quarter | year
```

The same `bucket` the chart uses. Groups are collapsible sections with
the count and the view's `summary:` computed per group (a monthly total
under each month), newest first for dates. Works for table, list and
board (a board grouped by week is the "week columns" people ask for).
Engine: `Query` gains `group_bucket`; `resolve_view` returns group keys
and per-group summaries so the CLI (`cortex view --group date --bucket
month`), MCP and the published site show the same sections. `@quarter`
joins the date words. **Effort: M.**

### 3.4 Chart types and chart polish

**Needs:** donut by category with name labels; column stacked by a
relation; height, hidden legend. **Also for:** every pack with a chart
(9 of 15) — a pie of tasks by status, time by project, books by genre.

**Design.** `chartType: donut | pie | bar | line | area`, `stack: true`
for series, `labels: name | value | name_value | none`, `legend: false`,
`height: small | medium | large`. Series over a relation groups by the
related row's title (it already does for selects). Still dependency-free
SVG; donut segments are arcs with the palette's tag colours; keyboard focus
cycles segments and reads the value. **Effort: S–M.**

### 3.5 KPI cards — a compact, cover-less gallery, and a stats view

**Needs:** the Categories cards (name, spent, budget, ring) and the
Accounts cards (name, balance) — small tiles that are read, not opened;
Notion's month tiles with "Income: $4,200 / Expenses: $3,100 / Net: $1,100".
**Also for:** habit streak tiles, project progress tiles, "due today"
counts, reading pace.

**Design, two parts.**
1. Gallery gains `layout: compact` (no cover, one row per property with
   label, the first non-title property large) and `size: small | medium |
   large`. That is the Categories and Accounts views verbatim.
2. A `stats` view: one tile per named figure, aggregated over a source with
   its own filter, no rows shown:
   ```yaml
   - name: This month
     type: stats
     stats:
       - {label: Spent, source: collections/expenses, agg: sum, field: amount, filter: "date >= @month", format: currency}
       - {label: Income, source: collections/incomes, agg: sum, field: amount, filter: "date >= @month"}
       - {label: Net, expr: "Income - Spent"}
   ```
   The engine already has `summarize`; this is that over several sources
   with a formula across the results. The CLI prints the same tiles as
   a table. **Effort: M.**

### 3.6 Ring display for percentages

**Needs:** Usage rings. **Also for:** habit completion, project progress,
reading progress — anywhere `format: progress` is used today.

**Design.** `format: ring` beside `progress`: same number, drawn as an arc
with the value inside; colour from the accent, red past 100%. Table cell,
gallery card, properties panel, and a `◔ 64%` glyph in the CLI. **Effort: S.**

### 3.7 Formula conveniences

**Needs (mapped from the template):** `formatDate` → `format_date(d,
"YYYY-MM")`; `dateSubtract` → `date_add(d, -1, "month")`;
`formatNumber("usd")` → `format_number(x, "$")`; `style("b")` → not
needed (labels come from the card); `.filter().map().sum()` over a relation
→ a rollup with `where:` (Cortex already does this better). Ship the
three functions and a "Notion formula → Cortex" table in
`docs/agent-integration.md` so pack authors and agents translate without
guessing. **Effort: S.**

### 3.8 Smaller

- **Show all** under a limited view (`limit: 10` today shows ten and says nothing). S.
- **Full-width page**: `width: full` in a note's frontmatter for dashboards; the prose column stays 740px elsewhere. S.
- **Section banners**: an image with `role: banner` renders edge to edge without a caption gap — or simply document that a heading with an emoji is the Markdown-native banner. XS.
- **Relations by id**: renaming a related row breaks the title-based relation (parity §4). Not finance-specific, but a finance pack has more relations than any other; an optional `id:` frontmatter key that relations may store alongside the title is the safe first step. M, later.

---

## 4. The plan

Ordered so each step ships value alone and the next builds on it. Effort
in the parity document's scale (S ≤ a day, M a few days, L a week or more).

| # | Step | Gives | Effort |
|---|---|---|---|
| 1 | **Chart types** (3.4) and **ring** (3.6) | Donuts and rings for every pack now; no format changes | S–M |
| 2 | **Period grouping** (3.3) with per-group summaries, `@quarter` | Weekly / Monthly / Yearly lists, month totals; replaces Notion's month rows | M |
| 3 | **KPI cards** (3.5): compact gallery, then `stats` view | Budget tiles, account balances, month tiles | M |
| 4 | **Buttons** (3.2) | One-click capture on every dashboard; palette entries | M |
| 5 | **Columns** (3.1) and `width: full` | The dashboard layout itself | L |
| 6 | **Formula functions** (3.7) and the translation table | Pack authors stop hitting walls | S |
| 7 | **Finance Tracker pack 3.0** (section 5) | The template, using 1–6 | M |
| 8 | Revisit Habit Tracker, Project Tracker, Weekly Review with the same pieces | Dashboards for the packs that want them | M |

Steps 1–3 are engine plus view code with CLI and MCP parity and site
rendering; 4 and 5 are editor blocks with a Markdown boundary; 7 is pack
work. Each step lands with its lint rules mirrored in the marketplace
repo's Python lint and a line in `AGENTS.md`.

**Acceptance for the finance dashboard**, end to end, in the app, from the
keyboard: install the pack; press the New expense button, type an amount,
Enter; the dashboard's Recent list shows it, the category's ring moves, the
month's donut changes, the account's balance drops — all computed, nothing
written but the one row.

---

## 5. Finance Tracker pack 3.0 — the target

Evolves `budget-tracker` (id kept, so updates flow) with what the template
has and Budget lacks: accounts, transfers, balances, a dashboard.

**Collections** (all nest under `budget`):

| Collection | Properties | Computed |
|---|---|---|
| `budget` (transactions) | title, date, amount (currency), kind (expense · income · transfer), category (rel → budget-limits), account (rel → accounts), to_account (rel → accounts, transfers only), payee, bill (rel → budget-bills) | — |
| `accounts` | title, kind (current · savings · cash · credit), initial (currency), active | income (rollup from budget where kind == income), spent (… expense), in (… transfer, to_account == this), out (… transfer, account == this), **balance** (formula) |
| `budget-limits` (categories) | title, monthly_limit, bucket | spent, last_month, remaining, **used** (`format: ring`) — as today |
| `budget-bills` | as today | as today |

One ledger stays the only thing typed into; a transfer is one row with
both accounts, which is simpler than the template's separate database
and keeps every movement in one place.

**The dashboard** is `collections/budget/_index.md` — the collection's
own page, which already renders prose around its views. Its body:

````markdown
::: columns 1 2 1
## Quick add
```cortex-button
label: New expense
action: add-row
collection: budget
values: {kind: expense, date: "{{today}}"}
open: true
```
(New income · New transfer likewise)

## Budgets
```cortex-view
source: collections/budget-limits
type: gallery
layout: compact
columns: [title, spent, monthly_limit, used]
filter: active == true
```
:::
## Spending
```cortex-view
source: collections/budget
type: list
columns: [title, category, amount, date]
filter: kind == 'expense'
sort: [date desc]
group: date
bucket: month
summary: {amount: sum}
limit: 30
```
## Income
(same, kind == 'income', bucket: month)
:::
## This month
```cortex-view
type: stats
stats: [...]
```
```cortex-view
source: collections/budget
type: chart
chartType: donut
x: category
y: amount
agg: sum
filter: kind == 'expense' and date >= @month
```
## Accounts
```cortex-view
source: collections/accounts
type: gallery
layout: compact
columns: [title, balance]
```
::: end
````

with the saved views (Ledger, This month, Month by month, By category,
Calendar) below as today. Seeds: three accounts, twelve transactions over
six weeks including two transfers, the three limits, two bills — so every
tile, ring and donut has a shape on install.

**Lint** learns the new pieces: a `cortex-button` must name an existing
collection and only known actions; `layout: compact` only on galleries;
`bucket` only with a date `group:`; a `stats` entry needs `agg` + `field`
or `expr`.

---

## 6. Decisions to confirm

1. **Columns syntax**: `::: columns` directive fences (proposed) versus an
   HTML `<div class="columns">` wrapper. Directives read better raw and are
   what other Markdown tools converge on; HTML renders on GitHub but hides
   Markdown inside it.
2. **Buttons as fences**: a code fence degrades to a visible YAML block in
   other viewers, which is honest. The alternative, a link with a
   `cortex:` scheme (`[New expense](cortex:add-row?collection=budget)`),
   is a one-liner but unreadable and clashes with the URL allow-list.
3. **Transfers as rows of the ledger** (proposed) versus a separate
   collection as in the template. One place, one `kind`, both accounts on
   the row.
4. **`stats` as a view type** versus a block of its own. A view keeps it
   in the same YAML, toolbar and CLI as everything else.
5. **Pack id**: evolve `budget-tracker` to 3.0 (updates flow, name stays
   "Budget Tracker") or ship `finance-tracker` beside it. Evolving is
   proposed; the card can be retitled.

References: the two Notion structures as dumped are in
`docs/parity/finance-tracker-notion.md`; the property, formula and view
details in §1 come from them. Related: `docs/parity/notion-parity.md` §1 (columns, buttons), §5–6
(views, grouping, summaries), `docs/parity/proposed-backlog.md`.
