---
created: "{{today}}"
icon: 📅
tags: []
title: Habit log
type: database
views:
- name: Calendar
  type: calendar
  date: date
- name: Table
  type: table
  columns: [title, date, done]
  sort: [date desc]
---

One file per day. `done:` lists the habits you completed that day; a day with
no file is a day with nothing done, and the first tick creates it. The body is
your note for the day — how it went, what got in the way. The Habits database
reads these files to draw its week, month and year views and to count streaks.
