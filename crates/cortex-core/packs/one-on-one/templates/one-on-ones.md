---
title: "{{title}}"
type: note
tags: [one-on-one]
date: "{{date}}"
person: []
kind: regular
status: planned
mood: ""
summary: ""
created: "{{date}}"
---

**When:** {{date}} {{time}}

## Their topics

Ask first. Paste in what they sent, or what is on their page.

- 

## My topics

- 

## Since last time

What they said they would do, what you said you would do, and what happened.
Their open follow-ups are on their page.

## Wins

- 

## Blockers

What is in the way, and which of them you can move.

- 

## Growth

Anything about the work they want more of, skills, the next role. Copy the
durable parts to the Career section of their page.

## Feedback

**Given:**

**Received:**

## Follow-ups

One line each, with who and when. Then give each a row in Follow-ups
(`person` and `one_on_one` set) so it shows below and on their page.

- [ ] me — 
- [ ] them — 

```cortex-view
source: collections/follow-ups
type: table
filter: one_on_one contains '{{title}}'
columns: [title, owner, due, status]
sort: [due asc]
```

## For their page

Themes worth keeping: a change in focus, a career point, feedback that
landed. Move them across before you close this note.
