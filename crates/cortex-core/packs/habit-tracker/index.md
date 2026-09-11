---
created: "{{today}}"
icon: 🔥
tags: []
title: Habits
type: database
width: full
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

::: columns 1 2 1

## Quick add

```cortex-button
label: Log today
action: add-row
collection: habit-log
values: {date: "{{today}}"}
open: true
```

```cortex-button
label: New habit
action: add-row
collection: habits
values: {frequency: daily, start: "{{today}}"}
open: true
```

## This month

```cortex-view
source: collections/habit-log
type: stats
stats:
  - {label: Days logged, source: collections/habit-log, agg: count, filter: "date >= @month"}
  - {label: Habits, source: collections/habits, agg: count, filter: "archived != true"}
  - {label: Logged this week, source: collections/habit-log, agg: count, filter: "date >= @monday"}
```

:::

## This week

```cortex-view
source: collections/habits
type: tracker
log: collections/habit-log
date: date
done: done
range: week
filter: archived != true
```

## Month

```cortex-view
source: collections/habits
type: tracker
log: collections/habit-log
date: date
done: done
range: month
filter: archived != true
```

:::

## Habits

```cortex-view
source: collections/habits
type: gallery
layout: compact
size: small
columns: [title, frequency, category]
filter: archived != true
```

## Days logged per week

```cortex-view
source: collections/habit-log
type: chart
chartType: bar
x: date
bucket: week
y: title
agg: count
height: small
```

::: end

```cortex-views
collection: habits
```

Every habit is a row here, with its own page (open it for its history and
your notes on why it matters). Every day is one file in `collections/habit-log/`
whose `done:` list names the habits you completed; a day with no file is a day
with nothing done, and the first tick creates it. Streaks, day scores and the
year heatmap are worked out from those files each time — nothing is stored,
so nothing is ever reset or goes stale.

Tick a habit with Space in the Today or This week view, with `mod+shift+h`
("Log today…") from anywhere, or from a terminal: `cortex tracker habits --log Exercise`.
Add a habit with New row; retire one by ticking `archived` instead of deleting
it, so its history stays.
