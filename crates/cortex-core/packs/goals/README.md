# Goals

Goals as rows, milestones as dated steps, check-ins as a log. Each goal's page
lists its milestones and charts its own progress from the check-ins, and the
board shows which goals are drifting.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/goals.yaml` | `.cortex/schemas/goals.yaml` | status, area, timeframe, priority, start, target, progress, measure |
| `schemas/goal-milestones.yaml` | `.cortex/schemas/goal-milestones.yaml` | `goal` (a relation to the goals), status, due |
| `schemas/goal-checkins.yaml` | `.cortex/schemas/goal-checkins.yaml` | `goal`, date, progress, confidence |
| `index.md` | `collections/goals/_index.md` | views: Board, Active, By area, Target dates, Achieved (with start and target dates); a progress chart in the body |
| `index/goal-milestones.md` | `collections/goal-milestones/_index.md` | views: Next up, Board, Calendar |
| `index/goal-checkins.md` | `collections/goal-checkins/_index.md` | views: Log, Progress (one line per goal), Calendar |
| `templates/goals.md` | `collections/goals/_template-goals.md` | a goal page: Why, Done means, its milestones, its progress chart and latest check-ins, Plan, In the way |
| `templates/goal-milestones.md` | `collections/goal-milestones/_template-goal-milestones.md` | a milestone: Done means, Steps |
| `templates/goal-checkins.md` | `collections/goal-checkins/_template-goal-checkins.md` | a check-in: Since last time, Next, In the way |
| `seed/goals/*.md` | `collections/goals/` | three example goals: Run a half marathon, Three months of expenses saved, Read 24 books |
| `seed/goal-milestones/*.md` | `collections/goal-milestones/` | three milestones for the half marathon |
| `seed/goal-checkins/*.md` | `collections/goal-checkins/` | two check-ins for the half marathon, showing the shape of a review |

The two extra databases nest under Goals in the sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install goals`).
2. **Open Goals** and write three goals with New row: an outcome with a
   `target` date, its `area`, a `timeframe`, and one line in `measure` saying
   how you will know it is done. Fill in the Why on the page while it is fresh.
3. **Break one down and check in, from the goal's page.** New row under
   Milestones adds a step already linked to the goal; give it a `due` date.
   New row under Progress, from the `goal-checkins` template, adds a check-in
   with the goal and today's date filled in; set `progress` 0 to 100 and
   `confidence`. Delete the example rows when yours are in.

After that the loop is weekly: open the Board, open each active goal and add
a check-in, move any goal whose colour has changed, copy the latest progress
number into the goal's `progress`.

## How it works

- **`status` is flow and health in one column.** `planned` → `on_track` /
  `at_risk` / `off_track` → `done` or `dropped`. The Board groups by it, so
  the yellow and red columns are the review agenda. `dropped` is a real
  ending: a goal you decided against is worth keeping, and Achieved and Active
  both filter it out.
- **Progress is a log, not a field.** Each check-in is a row with a date and a
  number; the Progress chart on the Check-ins page draws one line per goal,
  one point per week (the highest number logged that week), and each goal's
  page shows its own line. The goal's `progress` property is a copy of the
  latest number so tables can sort by it — it is the only thing you update by
  hand.
- **Milestones are binary.** todo, doing, done, with a due date. Next up lists
  every open milestone across goals in date order, which is the list to pull
  this week's tasks from. Nuance about how a milestone is going belongs in a
  check-in.
- **A goal's page is a dashboard.** The row template embeds three views
  filtered to `goal == '{{title}}'`: the milestones table, the progress chart
  and the ten latest check-ins. A New row inside any of them copies that
  filter into the new row, which is why a milestone or check-in made from the
  goal's page is already linked to it. The link is the goal's title, so if
  you rename a goal, change `goal` on its milestones and check-ins and the
  three filters on its page to match.
- **Everything is a filter you can read.** `Active` is `status != 'done' and
  status != 'dropped'`; a per-area dashboard in any note is a `cortex-view`
  block with `source: collections/goals` and `filter: area == 'health'`.

## Ideas

- A quarterly page: a note with a `cortex-view` board over `collections/goals`
  filtered `timeframe == 'quarter'`, and a second block over
  `collections/goal-milestones` as a calendar on `due`.
- OKRs: the goal is the objective, `measure` the key result; add a
  `key_result` text property to milestones if you want more than one.
- Pair it with Habit Tracker for the daily behaviour behind a goal, Budget
  Tracker for money goals, Reading List for reading goals, and the Weekly
  Review template, whose review step is where the check-ins get written.

## Upgrading from 1.x

Version 1 was a single `goals` collection with status, area, target, progress
and measure. Version 2 keeps that folder and those properties (their values
carry over), adds `timeframe`, `priority` and `start`, and installs the two
extra collections. Existing goal pages keep their old body; to get the
milestone table and progress chart on an old goal, copy the `cortex-view`
blocks from `collections/goals/_template-goals.md` and replace `{{title}}`
with the goal's title. `cortex packs update` never touches a row you wrote.
