# Weekly Review

One row per week: plan it on Monday, review it on Friday, and see the trend.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/weeks.yaml` | `.cortex/schemas/weeks.yaml` | `week` (its Monday), `status`, `rating`, `focus`, `areas`, `carried_over` |
| `index.md` | `collections/weeks/_index.md` | views: Weeks (table, newest first), Board by status, Calendar on `week`, Rating and Carried over (charts, one point per week) |
| `templates/weeks.md` | `collections/weeks/_template-weeks.md` | the page: a Monday plan, then the get-clear / get-current checklist, wins, what slipped, lessons, energy, carried over, next week's three |
| `seed/*.md` | `collections/weeks/` | one reviewed week (filled in, rated 7, two items carried) and one planned week, as examples |

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install weekly-review`).
2. **On Monday**, open Weekly review in the sidebar and press New row. The
   page is titled "Week of" and today's date. Set `focus` — one sentence —
   write three things under Top 3, close it.
3. **On Friday afternoon or Sunday evening**, open the same row. Read last
   week's review and the week's daily notes first, then work down the
   checklist and prompts. Set `rating` (1–10) and `carried_over` (how many
   items moved to next week), and change `status` to `reviewed`.

Twenty minutes, same time every week. If a week goes by without one, set it
to `skipped` rather than pretending: the Board is more useful honest.

## How it works

Each week is a file in `collections/weeks/`. The views read the properties;
the page holds the thinking.

| View | Question it answers |
|---|---|
| Weeks | The list, newest first — focus, rating, areas and carry-over of every week in a column each |
| Board | Which weeks are still *planned*? How many did I skip? |
| Calendar | Each review sits on its Monday; a month with a gap shows it |
| Rating | Is life getting better or worse, one point per week |
| Carried over | Is the backlog growing? Bars that climb mean plans that are too big |

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
  energy and sleep. The review starts by reading those seven pages; the
  open-loops list at the bottom of each day is what feeds **carried over**.
- **Tasks** and **Project Tracker** are what "task lists" and "projects" in
  the get-current checklist point at, if you use them.
- **Goals** is the longer horizon: glance at its board during "get current"
  so each goal keeps a next action.

## Ideas

- Add a `sleep_avg` or `energy_avg` number to the schema and copy the week's
  average from the journal's Energy chart into it; then chart it here next to
  the rating.
- Embed the last few weeks in a monthly or quarterly note:

  ```cortex-view
  source: collections/weeks
  type: table
  columns: [title, rating, focus, carried_over]
  sort: [week desc]
  ```

- Show the rating chart inside any dashboard note with the same fence and
  `type: chart`, `x: week`, `y: rating`.

## Upgrading from 1.x

Version 1 was a single note template, `templates/weekly-review.md`. Version 2
is a collection: weeks live in `collections/weeks/` and are created with New
row. If you edited the old template, the update keeps it; notes you wrote
from it are untouched. There is no automatic import of old reviews into the
collection.
