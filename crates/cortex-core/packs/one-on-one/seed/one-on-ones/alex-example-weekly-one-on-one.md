---
title: Alex — weekly 1:1 (example)
type: note
tags: [one-on-one]
date: "{{today-7}}"
person: [Alex (example)]
kind: regular
status: held
mood: fine
summary: "Handover on track; the on-call move bought the afternoons back; two candidates for the small project, I owe them the shortlist."
repeat: weekly
created: "{{today-7}}"
---

**When:** {{today-7}} 11:00

## Their topics

- Two pieces of work that could be the two-person project
- Whether the talk write-up is still worth doing

## My topics

- How the secondary on-call month is going
- Copy review timing for the sign-up form

## Since last time

I moved them to secondary on-call — done. The conference talk write-up is
still open on their side; they asked for another week.

## Wins

- Ran the deploy for the sign-up form flag without help.

## Blockers

- Waiting on the copy review; nothing to do until it lands.

## Growth

Two candidates for the two-person project: the metrics pipeline cleanup and
the staging rebuild. I will send a short write-up of each and we pick next
week.

## Feedback

**Given:** Good call pausing the flag rather than shipping around the review.

**Received:** —

## Follow-ups

- [ ] me — send the shortlist of the two candidate projects, in two days
- [ ] them — the talk write-up, carried over

```cortex-view
source: collections/follow-ups
type: table
filter: one_on_one contains 'Alex — weekly 1:1 (example)'
columns: [title, owner, due, days_left, status]
sort: [due asc]
```

## For their page

- Topics for next time: pick between the two candidates — done, on their page.

This row has `repeat: weekly`: when a weekly 1:1 is marked `held`, its
successor is written as a new row a week on.
