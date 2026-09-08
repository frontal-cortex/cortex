# Habit Tracker

Habits as rows, one file per day, every number computed on read.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/habits.yaml` | `.cortex/schemas/habits.yaml` | category, frequency, target, start, archived |
| `schemas/habit-log.yaml` | `.cortex/schemas/habit-log.yaml` | `date`, and `done` — a relation to the habits |
| `index.md` | `collections/habits/_index.md` | views: Today, This week, Month, Year (trackers), Habits (table) |
| `index/habit-log.md` | `collections/habit-log/_index.md` | views: Calendar, Table |
| `templates/habits.md` | `collections/habits/_template-habits.md` | New row's shape for a habit — its page embeds its own year of history |
| `templates/habit-log.md` | `collections/habit-log/_template-habit-log.md` | the shape of a day: `date`, `done: []`, room for a note |
| `templates/daily-with-habits.md` | `templates/daily-with-habits.md` | a daily-note template with today's habits at the top |
| `seed/habits/*.md` | `collections/habits/` | three habits to start from: Exercise, Read, Sleep by 11 |

No log is seeded. A day with no file is a day with nothing done; your first
tick creates today's file.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install habit-tracker`).
2. **Open Habits** in the sidebar. The Today view lists your habits with a
   checkbox each: press Space, or click. That writes one line into
   `collections/habit-log/YYYY-MM-DD.md` for today.
3. **Make them yours.** Edit the three seeded habits or add one with New row.
   Set `frequency` and `target`, and the streaks follow the rule you chose.

From anywhere in the app, `mod+shift+h` opens "Log today…". If you want the
habits in your daily note, point the `journal_template` setting at
`daily-with-habits.md` (Settings → Notes, or `cortex settings set journal_template=daily-with-habits.md`).

## How streaks work

| `frequency` | asks for | a streak is | today |
|---|---|---|---|
| `daily` | every day | consecutive days done | pending until ticked, never a miss |
| `weekdays` | Monday to Friday | consecutive weekdays done; weekends neither break nor extend it | same |
| `weekly` / `custom` with `target: n` | any `n` days per week | consecutive weeks that met the target; this week shows `3/5` | the current week is pending until met |

A habit is not expected before its `start` date. Tick `archived` to retire a
habit: it leaves the views but its history stays in the log files.

The Year view is a heatmap of the last 52 weeks. The week view marks the
current and longest streak per habit and a score per day; a day where every
expected habit is done is a perfect day.

## Adding and removing habits

A habit is a note in `collections/habits/`. New row gives it the template's
shape; its page has a "Why" section and a live year tracker filtered to that
habit. Renaming a habit renames it in the day files' `done:` lists as well.
Deleting the file keeps the day files as they are; archiving is the gentler
choice.

## Agents and the terminal

- `cortex tracker habits` prints the week grid with streaks.
- `cortex tracker habits --log Exercise` ticks a habit for today
  (`--date 2026-09-07` for another day, `--off` to untick).
- `cortex set collections/habit-log/2026-09-08 done+=Read` edits the day's
  list directly, creating the day from the template if needed.
- Over MCP, `tracker` reads the numbers and `track` logs a habit, so
  "I ran this morning" is one call. `AGENTS.md` in your vault explains the two
  collections.

## Upgrading from 1.x

Version 1 kept one row per habit per week with `mon`…`sun` checkbox columns
in `collections/habits/`. Version 2 uses that same folder for the habits
themselves, so the old rows are not migrated. Before installing 2.0.0, rename
the old folder — `collections/habits` → `collections/habits-old` and the
schema `.cortex/schemas/habits.yaml` → `habits-old.yaml` — to keep the history
readable, or install into a fresh vault. `cortex packs remove habit-tracker`
on the old install deletes only the files it wrote and never your rows.
