---
created: "{{today}}"
icon: 🚩
tags: []
title: Milestones
type: database
views:
- name: Calendar
  type: calendar
  date: due
- name: Upcoming
  type: table
  columns: [title, project, due, days_left, done]
  filter: done != true
  sort: [due asc]
- name: All
  type: table
  columns: [title, project, due, done]
  sort: [due desc]
---

One row per milestone: a dated step of a project, ticked `done` when it is
reached. `project` names the project it belongs to; that project's page
lists its milestones live, and its `progress` is the share of them that are
ticked. **Calendar** is every key date across every project on one page.
**Upcoming** is the ones not yet reached, soonest first, with `days_left`
counting down — negative means it slipped. Add one with New row here, or
with New row under the Milestones heading on a project's page, which fills
in `project` for you.
