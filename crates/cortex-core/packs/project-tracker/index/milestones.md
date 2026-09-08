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
  columns: [title, project, due, done]
  filter: done != true
  sort: [due asc]
- name: All
  type: table
  columns: [title, project, due, done]
  sort: [due desc]
---

One row per milestone: a dated step of a project, ticked `done` when it is
reached. `project` names the project it belongs to, and that project's page
lists its milestones live. The calendar here is every key date across every
project on one page — the closest thing to a timeline. Add one with New row
here, or with New row under the Milestones heading on a project's page,
which fills in `project` for you.
