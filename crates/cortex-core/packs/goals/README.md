# Goals

Goals as rows, milestones as dated steps, check-ins as a log. Each goal's
progress bar, share of milestones done, next milestone and days left are
worked out from the other two databases when you look; its page lists its
milestones and charts its own progress, and the board shows which goals are
drifting.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/goals.yaml` | `.cortex/schemas/goals.yaml` | status, area, timeframe, priority, start, target, `completed` (stamped when status becomes done), measure; computed: `progress`, `last_checkin`, `milestones_done`, `next_milestone`, `days_left` |
| `schemas/goal-milestones.yaml` | `.cortex/schemas/goal-milestones.yaml` | `goal` (a relation to the goals), status, due, `completed` (stamped) |
| `schemas/goal-checkins.yaml` | `.cortex/schemas/goal-checkins.yaml` | `goal`, date, progress, confidence |
| `index.md` | `collections/goals/_index.md` | views: Board, Active, Due for review, By area, Timeline (start to target), Achieved; a progress chart in the body |
| `index/goal-milestones.md` | `collections/goal-milestones/_index.md` | views: Next up, Overdue, Board, Calendar |
| `index/goal-checkins.md` | `collections/goal-checkins/_index.md` | views: Log, Progress (one line per goal), Calendar |
| `templates/goals.md` | `collections/goals/_template-goals.md` | a goal page: Why, Done means, its milestones, its progress chart and latest check-ins, Plan, In the way |
| `templates/goal-milestones.md` | `collections/goal-milestones/_template-goal-milestones.md` | a milestone: Done means, Steps |
| `templates/goal-checkins.md` | `collections/goal-checkins/_template-goal-checkins.md` | a check-in: Since last time, Next, In the way |
| `seed/goals/*.md` | `collections/goals/` | four example goals: Run a half marathon, Three months of expenses saved, Read 24 books, and Clear the credit card (done, so Achieved has a row) |
| `seed/goal-milestones/*.md` | `collections/goal-milestones/` | three milestones for the half marathon (one done, one due next week, one overdue) and one for the savings goal |
| `seed/goal-checkins/*.md` | `collections/goal-checkins/` | four check-ins spread over the last month, so the chart has lines and two goals are due for review |

The two extra databases nest under Goals in the sidebar. The seeds are dated
relative to the day you install, so the Timeline, Due for review, Overdue and
the progress chart all show something straight away.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install goals`).
2. **Open Goals** and write three goals with New row: an outcome with a
   `target` date, its `area`, a `timeframe`, and one line in `measure` saying
   how you will know it is done. Fill in the Why on the page while it is fresh.
3. **Break one down and check in, from the goal's page.** New row under
   Milestones adds a step already linked to the goal; give it a `due` date.
   New row under Progress, from the `goal-checkins` template, adds a check-in
   with the goal and today's date filled in; set `progress` 0 to 100 and
   `confidence`. The goal's `progress` bar and `milestones_done` update by
   themselves. Delete the example rows when yours are in.

After that the loop is weekly: open Due for review, open each goal on it and
add a check-in, move any goal whose colour has changed. When the list is
empty you are done.

## How it works

- **`status` is flow and health in one column.** `planned` → `on_track` /
  `at_risk` / `off_track` → `done` or `dropped`. The Board groups by it, so
  the yellow and red columns are the review agenda. Setting it to `done`
  stamps `completed` with the day, and Achieved sorts by that. `dropped` is
  a real ending: a goal you decided against is worth keeping, and Achieved
  and Active both filter it out.
- **Progress is a log, and the goal reads it.** Each check-in is a row with a
  date and a number. The goal's `progress` is a rollup: the highest number
  any of its check-ins logged, shown as a bar; `last_checkin` is the newest
  date. The Progress chart on the Check-ins page draws one line per goal,
  one point per week, and each goal's page shows its own line. Nothing is
  copied between rows.
- **Milestones are binary, and counted.** todo, doing, done, with a due date;
  done stamps `completed`. The goal's `milestones_done` is the share of its
  milestones that are done and `next_milestone` the earliest open date, so
  the Active table says where each goal stands without opening it. Next up
  lists every open milestone across goals in date order; Overdue is the ones
  whose date passed. Nuance about how a milestone is going belongs in a
  check-in.
- **Due for review is a date filter.** `last_checkin < @today-7 or
  last_checkin == '' and status != 'done' and status != 'dropped'`: open
  goals with no check-in in the last week, including ones never checked in.
  Filters read left to right, so the `or` binds first and the status tests
  apply to both halves.
- **Active sorts by priority.** A select sorts in the order its options are
  declared (high, medium, low), then by nearest target. `days_left` is
  `days_until(target)`, negative once the date has passed.
- **A goal's page is a dashboard.** The row template embeds three views
  filtered to `goal == '{{title}}'`: the milestones table, the progress chart
  and the ten latest check-ins. A New row inside any of them copies that
  filter into the new row, which is why a milestone or check-in made from the
  goal's page is already linked to it. The link is the goal's title, so if
  you rename a goal, change `goal` on its milestones and check-ins and the
  three filters on its page to match; the rollups follow the same title.
- **Everything is a filter you can read.** `Active` is `status != 'done' and
  status != 'dropped'`; a per-area dashboard in any note is a `cortex-view`
  block with `source: collections/goals` and `filter: area == 'health'`, and
  it gets the computed columns too.

## Ideas

- A quarterly page: a note with a `cortex-view` timeline over
  `collections/goals` filtered `timeframe == 'quarter'` (`start: start`,
  `end: target`), and a second block over `collections/goal-milestones` as a
  calendar on `due`.
- OKRs: the goal is the objective, `measure` the key result; add a
  `key_result` text property to milestones if you want more than one.
- A "slipping" view: `days_left < 30 and progress < 70` on the goals
  collection — a formula-free way to catch the ones that will not make it.
- Pair it with Habit Tracker for the daily behaviour behind a goal, Budget
  Tracker for money goals, Reading List for reading goals, and the Weekly
  Review template, whose review step is where the check-ins get written.

## Agents and the terminal

- `cortex view goals --filter "status != 'done' and status != 'dropped'" --sort priority`
  prints the open goals in priority order; `--json` for a script. The
  computed columns (`progress`, `milestones_done`, `days_left`) are filled
  in by the app and by MCP's `run_view`; `cortex view` prints the stored
  properties.
- `cortex set "collections/goal-checkins/$(date -I)-half-marathon" goal+="Run a half marathon" progress=40 confidence=high`
  logs a check-in from a terminal; the goal's bar moves the next time it is
  read.
- Over MCP, `run_view` with `source: collections/goals` and the Due for
  review filter returns the list with `last_checkin` and `progress` filled
  in, so an agent can answer "which goals have I not reviewed this week"
  without any bookkeeping on its side.

## Upgrading

**From 2.0.** The goal's `progress` is now computed from its check-ins, so
the stored `progress:` on an existing goal is ignored on read; delete the line
or leave it. The Target dates calendar became the Timeline (start to target).
`completed` on goals and milestones is stamped from the moment the new schema
is in place; goals already done have no date until you add one. Everything
else carries over; `cortex packs update` never touches a row you wrote.

**From 1.x.** Version 1 was a single `goals` collection with status, area,
target, progress and measure. Version 2 keeps that folder and those
properties, adds `timeframe`, `priority` and `start`, and installs the two
extra collections. Existing goal pages keep their old body; to get the
milestone table and progress chart on an old goal, copy the `cortex-view`
blocks from `collections/goals/_template-goals.md` and replace `{{title}}`
with the goal's title.
