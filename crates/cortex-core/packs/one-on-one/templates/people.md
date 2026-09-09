---
title: "{{title}}"
type: note
tags: [person]
relationship: report
role: ""
team: ""
cadence: weekly
focus: ""
start: "{{date}}"
archived: false
created: "{{date}}"
---

## About

Role, how they like to work, what they care about outside work. The things
that make the next conversation easier.

## Current focus

What they are working towards this quarter, and the one thing that would make
the biggest difference to them.

## Career

Where they want to be in a year or two, and the last time you talked about it.

## Topics for next time

The running agenda. Add to it between meetings; move a topic into the 1:1
when you raise it.

- [ ] 

## Feedback given

Dated one-liners. What you said, and what changed.

- 

## Open follow-ups

```cortex-view
source: collections/follow-ups
type: table
filter: person contains '{{title}}' and status == 'open'
columns: [title, owner, due, days_left, one_on_one]
sort: [due asc]
```

## 1:1s

```cortex-view
source: collections/one-on-ones
type: table
filter: person contains '{{title}}'
columns: [title, date, status, mood, kind, summary]
sort: [date desc]
```
