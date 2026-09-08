---
title: "{{title}}"
type: note
tags: []
status: planned
priority: p2
area:
start: "{{date}}"
deadline:
completed:
progress: 0
next_action:
created: "{{date}}"
---

## Outcome

What finished looks like, in one or two sentences. If this is hard to write,
the project is not ready to start.

## Why now

Why this, why now, and what happens if it waits.

## Milestones

```cortex-view
source: collections/milestones
type: table
columns: [title, due, done]
sort: [due asc]
filter: project == '{{title}}'
```

## Tasks

Tasks from the Tasks pack that name this project. Delete this section if
you do not use that pack.

```cortex-view
source: collections/tasks
type: board
group: status
filter: project == '{{title}}'
```

## Log

### {{date}}

- Started.
