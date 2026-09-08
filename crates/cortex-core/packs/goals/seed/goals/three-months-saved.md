---
title: Three months of expenses saved
type: note
tags: []
icon: 🏦
status: on_track
area: money
timeframe: year
priority: medium
start: "{{today}}"
target: "{{today}}"
progress: 20
measure: "Savings account holds three months of average spending."
created: "{{today}}"
---

An example money goal. The Budget Tracker pack gives you the monthly spending
number this is measured against.

## Why

So that a broken boiler or a quiet month at work is an inconvenience and not
a crisis.

## Done means

The savings balance equals three times the average monthly spend from the
budget ledger.

## Milestones

```cortex-view
source: collections/goal-milestones
type: table
columns: [title, status, due]
sort: [due]
filter: goal == 'Three months of expenses saved'
```

## Progress

```cortex-view
source: collections/goal-checkins
type: chart
chartType: line
x: date
y: progress
bucket: week
agg: max
filter: goal == 'Three months of expenses saved'
```

```cortex-view
source: collections/goal-checkins
type: table
columns: [title, date, progress, confidence]
sort: [date desc]
limit: 10
filter: goal == 'Three months of expenses saved'
```

## Plan

- [ ] Standing order on payday, before anything else
- [ ] Work out the real monthly number from three months of the ledger
- [ ] Review the amount each quarter

## In the way

Treating the savings account as a second checking account. Keep it at a
different bank.
