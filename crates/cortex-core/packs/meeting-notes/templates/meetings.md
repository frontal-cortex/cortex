---
title: "{{title}}"
type: note
tags: [meeting]
date: "{{date}}"
kind: team
status: scheduled
attendees: []
project: ""
summary: ""
link: ""
created: "{{date}}"
---

**When:** {{date}} {{time}}
**Where:**

## Attendees

- 

Note who was expected and absent if it matters for the decisions.

## Agenda

1. 

Specific topics with a question or a decision each, not headers.

## Notes

## Decisions

- 

State each as a sentence: what was decided, not what was discussed.

## Action items

One line each: a verb, one owner, a date. Then give each a row in Action
items (`meeting` set to this meeting) so it shows below and in Open.

- [ ] 

```cortex-view
source: collections/action-items
type: table
filter: meeting contains '{{title}}'
columns: [title, owner, due, status]
sort: [due asc]
```

## Open questions

- 

## Next meeting

**When:**
**Bring:**
