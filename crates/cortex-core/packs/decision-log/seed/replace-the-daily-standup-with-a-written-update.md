---
title: Replace the daily standup with a written update
type: note
tags: [decision]
icon: 📝
status: accepted
decided: "{{today-75}}"
review: "{{today-15}}"
reviewed: "{{today-14}}"
area: team
impact: low
reversible: true
confidence: 80
owner:
outcome: as_expected
supersedes: []
link:
created: "{{today}}"
---

## Context

Six people across three time zones; the 9:30 standup is 7:30 for one of
them and 15:30 for another, and the middle of the day is lost either side of
it. Nobody remembers what was said by lunch.

**State of mind:** mid-morning, mildly irritated after a standup that ran to
twenty-five minutes.

## Options

### A — Written update in the team channel by 10:00, no meeting

- Good: everyone reads it when their day starts; a searchable record.
- Bad: blockers may sit unread for a few hours.

### B — Keep the standup, cap it at ten minutes

- Good: no change to learn.
- Bad: the cap has been tried twice.

### Do nothing

- Good: nothing.
- Bad: one person keeps starting at 7:30.

## Decision

A, because the record is worth more than the ritual and the time zones are
not going away.

## Expected outcome

Updates posted four days in five; no blocker waits more than half a day.
Confidence 80%. What would prove this wrong: a blocker found two days late
that a standup would have caught.

## Consequences

Easier: mornings, catching up after leave. Harder: spotting that someone is
quietly stuck. Given up: the one time a day everyone is on a call.

## Review

Updates were posted nine days in ten and the channel is now where planning
starts. One blocker sat for a morning; nothing was two days late. As
expected — reviewed a day after the `review` date, which is what
`days_between(review, reviewed)` would show.
