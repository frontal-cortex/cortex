---
title: Use Postgres for the catalogue
type: note
tags: [decision]
icon: 🐘
status: accepted
decided: "{{today}}"
review: "{{today}}"
area: engineering
impact: high
reversible: false
confidence: 85
owner:
outcome: pending
supersedes: [Use a document store for the catalogue]
link:
created: "{{today}}"
---

## Context

The catalogue's shape has settled: four fixed fields per item plus a small
per-category blob. Reporting across categories is now the most requested
feature and the document store makes it slow to build.

**State of mind:** morning, rested, after a week of measuring rather than
arguing.

## Options

### A — Postgres, fixed columns plus a JSONB column for the blob

- Good: joins and reporting for free; the team knows it; managed hosting.
- Bad: a migration of live data; a fortnight of dual-writes.

### B — Keep the document store and add a reporting replica

- Good: no migration.
- Bad: two systems to keep in sync, for a shape that no longer needs the
  flexibility.

### Do nothing

- Good: nothing.
- Bad: reporting stays a quarter of every sprint.

## Decision

A, because the flexibility we bought last time is no longer being used and
the cost of not having joins is paid every week.

## Expected outcome

Migration done within a month with no customer-visible downtime; reporting
features taking days rather than weeks afterwards. Confidence 85%. What
would prove this wrong: a category whose shape refuses to fit the four
fields.

## Consequences

Easier: reporting, integrity constraints, hiring. Harder: adding a truly new
item shape needs a migration. Given up: the ability to store anything.

## Review

On the review date, compare reporting lead time before and after the
migration, and whether any category refused to fit the four fields.

### Superseded by

```cortex-view
source: collections/decisions
type: table
columns: [title, status, decided]
filter: supersedes contains 'Use Postgres for the catalogue'
```
