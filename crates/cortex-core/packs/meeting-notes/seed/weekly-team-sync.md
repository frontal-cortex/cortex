---
title: Weekly team sync (example)
type: note
tags: [meeting]
icon: 🗓️
date: "{{today-7}}"
kind: team
status: followed-up
repeat: weekly
attendees: []
project: "Onboarding flow"
summary: "Agreed to ship the new sign-up form behind a flag; support hand-off moves to Thursday."
link: ""
created: "{{today-7}}"
---

**When:** {{today-7}} 10:00
**Where:** the usual room

## Attendees

- The whole team; design was out.

## Agenda

1. Is the new sign-up form ready to ship, or does it wait for the copy review?
2. Which day does the support hand-off move to?
3. Anything blocking the onboarding flow this week?

## Notes

The form works on every browser we test. Copy review is still open, so it
ships behind a flag and the flag flips when the review lands. The Thursday
hand-off suits support better than Monday, which lands on their busiest day.

## Decisions

- The new sign-up form ships this week behind a feature flag.
- The support hand-off moves from Monday to Thursday, starting next week.

## Action items

- [x] Send the summary — owner: me — due: the next day
- [ ] Flip the sign-up form flag once copy signs off — owner: me — due: two days ago

```cortex-view
source: collections/action-items
type: table
filter: meeting contains 'Weekly team sync (example)'
columns: [title, owner, due, days_left, status]
sort: [due asc]
```

## Open questions

- Who owns the flag flip once copy signs off?

## Next meeting

**When:** same time next week — this row has `repeat: weekly`, so each sync's
successor is written as a new row the moment the sync is marked `followed-up`.
**Bring:** the flag flip date, first support numbers from the Thursday hand-off
