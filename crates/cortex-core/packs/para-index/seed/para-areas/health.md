---
title: Health
type: note
tags: []
icon: 🏃
category: health
status: active
standard: "Move three times a week, sleep seven hours, see the dentist twice a year."
review: monthly
next_review: "{{today}}"
created: "{{today-30}}"
---

## Standard

Move three times a week, sleep seven hours, see the dentist twice a year. Not
a goal to hit once — a level to hold.

## Projects

```cortex-view
source: collections/para-projects
type: table
columns: [title, status, priority, deadline, days_left]
filter: area contains 'Health' and status != 'done' and status != 'dropped'
sort: [priority desc, deadline]
```

## Resources

```cortex-view
source: collections/para-resources
type: table
columns: [title, kind, status, url]
filter: area contains 'Health' and status != 'archived'
sort: [created desc]
```

## Reviews

- {{today-30}} — Standard written. One active project, Run a 10k; its training plan is filed under Resources.
