---
title: Clear the credit card
type: note
tags: []
icon: 💳
status: done
area: money
timeframe: quarter
priority: high
start: "{{today-120}}"
target: "{{today-10}}"
completed: "{{today-16}}"
measure: "Card balance at zero and the statement shows no interest."
created: "{{today}}"
---

An example of a finished goal, so Achieved has a row on the day you install.
`completed` was written the day `status` became done — on your own goals the
app stamps it for you — and it beat its target by six days.

## Why

Interest was the one bill that bought nothing.

## Done means

A statement with a zero balance and no interest line.

## Milestones

```cortex-view
source: collections/goal-milestones
type: table
columns: [title, status, due]
sort: [due]
filter: goal == 'Clear the credit card'
```

## Progress

```cortex-view
source: collections/goal-checkins
type: table
columns: [title, date, progress, confidence]
sort: [date desc]
limit: 10
filter: goal == 'Clear the credit card'
```
