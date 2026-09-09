---
title: Career
type: note
tags: []
icon: 💼
category: work
status: active
standard: "Doing work I would choose again, learning one new skill a year, network warm."
review: quarterly
next_review: "{{today+20}}"
created: "{{today-70}}"
---

## Standard

Doing work I would choose again, learning one new skill a year, and a network
warm enough that a call is never awkward.

## Projects

```cortex-view
source: collections/para-projects
type: table
columns: [title, status, priority, deadline, days_left]
filter: area contains 'Career' and status != 'done' and status != 'dropped'
sort: [priority desc, deadline]
```

## Resources

```cortex-view
source: collections/para-resources
type: table
columns: [title, kind, status, url]
filter: area contains 'Career' and status != 'archived'
sort: [created desc]
```

## Reviews

- {{today-70}} — Standard written; the home office is the one project here.
- {{today-9}} — Home office done. Nothing active until the next quarterly review.
