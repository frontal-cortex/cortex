---
title: File the tax return
type: note
tags: []
icon: 🧾
status: done
priority: p2
area: personal
start: "{{today-20}}"
deadline: "{{today+3}}"
completed: "{{today-4}}"
next_action:
created: "{{today-20}}"
---

## Outcome

Filed, paid, and the confirmation saved in `notes/`.

## Why now

The deadline is fixed and the penalty is not small.

## Milestones

```cortex-view
source: collections/milestones
type: table
columns: [title, due, days_left, done]
sort: [due asc]
filter: project == 'File the tax return'
```

## Log

### {{today-4}}

- Filed, four days early. Setting `status` to `done` stamped `completed`
  with this date; that is this month's bar in Finished per month. No
  milestones — a short project does not need them — so `progress` is empty.

### {{today-20}}

- Started: gathered last year's statements.
