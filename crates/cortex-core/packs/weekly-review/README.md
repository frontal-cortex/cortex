# Weekly Review

One row per week: plan it at the start, review it at the end, and see the
trend.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/weeks.yaml` | `.cortex/schemas/weeks.yaml` | `week` (its Monday), `status`, `rating`, `focus`, `areas`, `carried_over`, `reviewed_on` (stamps itself), and three columns computed from Daily Note: `days_written`, `energy_avg`, `sleep_avg` |
| `index.md` | `collections/weeks/_index.md` | views: To review (planned weeks whose Friday has come), Weeks (table, newest first), Board by status, Calendar on `week`, Rating and Carried over (charts, one point per week) |
| `templates/weeks.md` | `collections/weeks/_template-weeks.md` | the page: a plan, then the get-clear / get-current checklist, wins, what slipped, lessons, energy, carried over, next week's three |
| `seed/*.md` | `collections/weeks/` | last week, reviewed (filled in, rated 7, two items carried), and this week, planned — so the table, board, calendar and charts have something in them on install |

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install weekly-review`).
2. **At the start of the week**, open Weekly review in the sidebar and press
   New row. Whatever day it is, the page is titled "Week of" that week's
   Monday and `week` is set to it. Set `focus` — one sentence — write three
   things under Top 3, close it.
3. **On Friday afternoon or Sunday evening**, open the same row — from
   Friday it is waiting in **To review**. Read last week's review and the
   week's daily notes first, then work down the checklist and prompts. Set
   `rating` (1–10) and `carried_over` (how many items moved to next week),
   and change `status` to `reviewed`; `reviewed_on` fills itself with the
   day you did it.

Twenty minutes, same time every week. If a week goes by without one, set it
to `skipped` rather than pretending: the Board is more useful honest, and
the week leaves To review either way.

## How it works

Each week is a file in `collections/weeks/`. The views read the properties;
the page holds the thinking.

| View | Question it answers |
|---|---|
| To review | Which weeks am I due to close? Every *planned* week from its Friday on — this week, and any older one still open. Empty is the goal |
| Weeks | The list, newest first — status, rating, focus, areas, carry-over, and the journal's day count and averages, a column each |
| Board | Where does every week stand? The *skipped* column is the honest count |
| Calendar | Each review sits on its Monday; a month with a gap shows it |
| Rating | Is life getting better or worse, one point per week |
| Carried over | Is the backlog growing? Bars that climb mean plans that are too big |

To review is `status == 'planned' and week <= @today-4` — a week's Monday
plus four days is its Friday, so the row appears the day the review falls
due and stays until the status changes. `reviewed_on` is a date with
`auto: status == reviewed`: the day you flip the status it takes today's
date, once, and keeps it.

`days_written`, `energy_avg` and `sleep_avg` are rollups over Daily Note's
`collections/journal`: every day whose `week` names this row is counted, and
its `energy` and `sleep` averaged. They are computed when a view is read and
never written to the file, so they are simply empty when Daily Note is not
installed, and they update the moment a day is added or edited. Daily Note's
template fills a day's `week` with "Week of" and its Monday, which is what
this pack titles a week, so the two meet without you doing anything.

The page's review half is David Allen's weekly review from *Getting Things
Done*, cut to what a notes app can help with: **get clear** (inbox to zero,
empty your head), **get current** (task lists, past and coming calendar,
waiting-for, projects, someday/maybe). After the checklist come the prompts
that make the review worth reading later — wins, what slipped, lessons, what
gave and drained energy — then the **carried over** list, whose rule is
that every item goes into next week's Top 3 or is dropped on purpose. Three
weeks running on that list means the plan is wrong, not the week.

`areas` (work, health, family, friends, learning, creative, money, home) is
for filtering: `areas contains 'health'` in the Weeks table reads a quarter of
health notes in one sitting.

## Alongside other packs

- **Daily Note** keeps one row per day in `collections/journal/`, with mood,
  energy and sleep. Its This week view is the seven pages the review starts
  by reading; the open-loops list at the bottom of each day is what feeds
  **carried over**; and its `week` link is what fills `days_written`,
  `energy_avg` and `sleep_avg` here.
- **Tasks** and **Project Tracker** are what "task lists" and "projects" in
  the get-current checklist point at, if you use them.
- **Goals** is the longer horizon: glance at its board during "get current"
  so each goal keeps a next action.

## Ideas

- Put the journal's energy next to the rating as a chart: the same fence as
  below with `type: chart`, `x: week`, `y: energy_avg`, `agg: avg`,
  `bucket: week` draws the computed column like any number.
- Embed the last few weeks in a monthly or quarterly note:

  ```cortex-view
  source: collections/weeks
  type: table
  columns: [title, rating, focus, carried_over, energy_avg]
  sort: [week desc]
  ```

- Show the rating chart inside any dashboard note with the same fence and
  `type: chart`, `x: week`, `y: rating`.
- A quarter at a glance: a table with `filter: week >= @today-91`, or a
  chart of `rating` over it with `bucket: month`.

## Upgrading from 2.0

Your weeks are untouched. New: the To review view; `reviewed_on`, which
stamps itself from now on (weeks you already reviewed stay blank unless you
fill the date in); and the three columns computed from Daily Note. New rows
are titled "Week of" the week's Monday whatever day you press New row —
rows you made before keep their titles; if one was made on a Tuesday, rename
it to its Monday so Daily Note's days find it. If you edited
`_template-weeks.md`, the update keeps your copy; change its `title:` and
`week:` lines to `{{monday}}` by hand to get the same.

## Upgrading from 1.x

Version 1 was a single note template, `templates/weekly-review.md`. Version 2
is a collection: weeks live in `collections/weeks/` and are created with New
row. If you edited the old template, the update keeps it; notes you wrote
from it are untouched. There is no automatic import of old reviews into the
collection.
