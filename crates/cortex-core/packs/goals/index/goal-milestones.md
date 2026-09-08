---
created: "{{today}}"
icon: 🪜
tags: []
title: Milestones
type: database
views:
- name: Next up
  type: table
  columns: [title, goal, status, due]
  filter: status != 'done'
  sort: [due]
- name: Board
  type: board
  group: status
- name: Calendar
  type: calendar
  date: due
---

The steps between here and a goal, each with a due date and the `goal` it
belongs to. Two or three per goal is plenty: the first thing that would prove
the goal is moving, the point of no return, and the finish. Add them from the
goal's page — New row under Milestones links the step to that goal — or here,
setting `goal` yourself. A milestone is done or not; the nuance goes in the
check-ins.

Next up is every open milestone in date order across all goals, which is the
list to pull this week's tasks from. The Board is the same rows as todo,
doing and done, and the Calendar shows where the month gets crowded. Each
goal's page lists only its own.
