---
created: "{{today}}"
icon: 🔥
tags: []
title: Habits
type: database
views:
- name: Today
  type: tracker
  log: collections/habit-log
  date: date
  done: done
  range: today
- name: This week
  type: tracker
  log: collections/habit-log
  date: date
  done: done
  range: week
- name: Month
  type: tracker
  log: collections/habit-log
  date: date
  done: done
  range: month
- name: Year
  type: tracker
  log: collections/habit-log
  date: date
  done: done
  range: year
- name: Habits
  type: table
  columns: [title, category, frequency, target, start, archived]
---

Every habit is a row here, with its own page (open it for its history and
your notes on why it matters). Every day is one file in `collections/habit-log/`
whose `done:` list names the habits you completed; a day with no file is a day
with nothing done, and the first tick creates it. Streaks, day scores and the
year heatmap are worked out from those files each time — nothing is stored,
so nothing is ever reset or goes stale.

Tick a habit with Space in the Today or This week view, with `mod+shift+h`
("Log habit…") from anywhere, or from a terminal: `cortex tracker habits --log Exercise`.
Add a habit with New row; retire one by ticking `archived` instead of deleting
it, so its history stays.
