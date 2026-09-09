---
created: "{{today}}"
icon: 🧭
tags: []
title: Areas
type: database
views:
- name: Areas
  type: table
  columns: [title, category, status, standard, open_projects, resources, review, next_review, review_in]
  filter: status != 'archived'
  sort: [next_review]
- name: Due for review
  type: table
  columns: [title, standard, open_projects, review, next_review, review_in]
  filter: next_review <= @today and status != 'archived'
  sort: [next_review]
- name: By category
  type: board
  group: category
  filter: status != 'archived'
- name: Reviews
  type: calendar
  date: next_review
- name: Archive
  type: table
  columns: [title, category, status, standard]
  filter: status == 'archived'
---

An area is a part of your life you are responsible for as long as you live it
— Health, Finances, Career — with no finish line, only a standard to keep.
Projects and Resources nest under it here because that is how PARA works: a
project serves an area, a resource supports an area or a project. Open an
area's page and it lists its own active projects and resources; the table
counts them for you in `open_projects` and `resources`, so an area that has
quietly grown four projects shows it at a glance.

Start with three to six areas. Write the standard in one sentence ("Run three
times a week and sleep seven hours") and set a review cadence. `review_in` is
the days until `next_review`; Due for review lists the areas whose date has
arrived, and the Reviews calendar shows the rest. When you review, set
`next_review` to the next date your cadence gives, add a dated line to the
page, and check whether any project under it should be started, finished or
dropped.

Nothing is moved to an Archive folder. An area you no longer hold becomes
`archived`; a project becomes `done` or `dropped`; a resource `archived`. The
Archive views filter on that, so links and history stay intact.

## Active projects

```cortex-view
source: collections/para-projects
type: table
columns: [title, area, status, priority, deadline, days_left]
filter: status == 'active' or status == 'on hold'
sort: [priority desc, deadline]
```
