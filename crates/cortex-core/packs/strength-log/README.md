# Strength Log

A push/pull/legs log where the only things you type are a weight and a number
of reps. One row per set, so a lift can be charted over time; everything
else — volume, one-rep-max estimates, session totals, records, what you have
not trained lately — is worked out when you look at it.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `index.md` | `collections/training/_index.md` | the dashboard: this week against last, buttons for a push, pull or leg day, twelve weeks of volume, sets per muscle, your records, sessions, and the lifts going stale |
| `schemas/workouts.yaml`, `index/workouts.md` | `collections/workouts/` | date, day, duration, bodyweight, feel; computed `sets_done`, `reps_done`, `volume`, `top_set`, `hard_sets`; views Recent, This week, By day, Calendar, Volume per week |
| `schemas/sets.yaml`, `index/sets.md` | `collections/sets/` | `exercise` → Exercises, `workout` → Workouts, weight, reps, rpe, kind; computed `date`, `volume`, `e1rm`, `muscle`, `day`; views Recent, This week, Per week, By muscle, Heaviest |
| `schemas/exercises.yaml`, `index/exercises.md` | `collections/exercises/` | day, muscle, equipment, target reps, rest; computed `sets_done`, `best_weight`, `best_e1rm`, `last_done`, `volume_30d`, `days_since`; views By day, Records, Overdue, Catalogue, Volume |
| `templates/*.md` | `collections/*/_template-*.md` | the shape of a new session, set and movement — a session's page carries its own totals and the table you log into |
| `seed/*/*.md` | `collections/*/` | thirteen movements across the three days, four sessions and fifteen sets over the last fortnight, so every chart and record has something in it from the start |

All three databases nest under Training in the sidebar.

## How to log

1. **Press the day** on the dashboard — Push, Pull or Leg day. A session opens,
   dated today.
2. **Add your sets** in the table on that page. **+ New row** adds a set that
   already belongs to the session, so you pick the movement, type the weight
   and the reps, and that is the set.
3. **A warmup** is a set with `kind: warmup`. It stays out of every total,
   record and chart.
4. **RPE is optional.** Fill it when you care how hard a set was; the count of
   hard sets (8 or above) is there when you do.

Before a session, open the movement you are about to do: its page has the
heaviest you have lifted, the best estimate, the last day you did it and every
set you have logged. That is what to beat.

## What is computed

- **Volume** — `weight × reps` per set; a session's volume is its working sets
  added up.
- **Estimated one-rep max** — Epley: `weight × (1 + reps ÷ 30)`, rounded. It is
  honest from two to about twelve reps, so above twelve it is left empty
  rather than made up. Warmups have none.
- **A set's date, muscle and day** — read from its session and its movement,
  so they are right without being typed and cannot fall out of step.
- **Per movement** — sets done, heaviest set, best estimate, last day trained,
  volume over thirty days, and days since.
- **Per session** — sets, reps, volume, top set, hard sets.

## Agents and the terminal

- `cortex set collections/workouts/push-today title="Push — today" date=2026-09-19 day=push`
  starts a session.
- `cortex set collections/sets/bench-1 'exercise=["Bench press"]' 'workout=["Push — today"]' weight=82.5 reps=8 rpe=8`
  logs a set.
- `cortex view exercises --view Records` prints your records; `cortex view sets
  --view "Per week"` prints the volume per week. Add `--json` for a script.
- Over MCP, `create_note` in `collections/sets` and `set_properties` log sets,
  and `run_view` reads the same numbers the app shows.

## Why one row per set

A row per exercise per session is tidier until the day you ramp: 60, 62.5,
62.5 cannot be written as `3×8 @62.5` without losing what happened, and every
template that tries ends up duplicating rows anyway. A row per set is the only
shape that charts a lift honestly — and here it costs a click, because the
session page fills in everything except the weight and the reps.
