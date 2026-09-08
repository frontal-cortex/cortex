---
title: "{{title}}"
type: note
tags: []
relationship: acquaintance
cadence: quarterly
company:
role:
email:
phone:
location:
website:
birthday:
last_contact:
follow_up:
archived: false
created: "{{date}}"
---

## About

How you met, what they do, what they care about.

## Remember

Partner and kids, interests, things they mentioned, dates that matter.

## Next time

- [ ] 

## Interactions

```cortex-view
source: collections/interactions
type: table
columns: [title, date, kind, summary]
filter: people contains '{{title}}'
sort: [date desc]
```
