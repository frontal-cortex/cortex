---
title: Use a document store for the catalogue
type: note
tags: [decision]
icon: 🗄️
status: superseded
decided: "{{today}}"
review: "{{today}}"
area: engineering
impact: high
reversible: false
confidence: 70
owner:
outcome: worse
supersedes: []
link:
created: "{{today}}"
---

## Context

The product catalogue has a different shape for every category and the
schema changes weekly. Two engineers, no DBA, launch in six weeks.

**State of mind:** late evening, tired, keen to stop debating.

## Options

### A — Document store

- Good: no migrations while the shape is still moving; fast to start.
- Bad: reporting queries across categories are awkward; nobody on the team
  has run one in production.

### B — Relational with a JSON column

- Good: known tooling, real joins for reporting.
- Bad: felt like a compromise; migrations for the fixed columns.

### Do nothing

- Good: nothing.
- Bad: no catalogue.

## Decision

A, because schema churn was the loudest problem that week.

## Expected outcome

Shipping in six weeks with no schema-related delays. Confidence 70%. What
would prove this wrong: reporting becoming the bottleneck within a quarter.

## Consequences

Faster start; reporting and integrity checks pushed to application code.

## Review

Reporting was the bottleneck within two months, and the "flexible" shapes
had converged on four fields anyway. The gap: we optimised for the first six
weeks and not for the next two years. Superseded — see below.

### Superseded by

```cortex-view
source: collections/decisions
type: table
columns: [title, status, decided]
filter: supersedes contains 'Use a document store for the catalogue'
```
