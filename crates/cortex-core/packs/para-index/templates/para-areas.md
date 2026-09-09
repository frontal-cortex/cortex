---
title: "{{title}}"
type: note
tags: []
category: personal
status: active
standard:
review: monthly
next_review: "{{date+30}}"
created: "{{date}}"
---

## Standard

What "good" looks like in this area, in one or two sentences. This is what a
review checks against.

## Projects

```cortex-view
source: collections/para-projects
type: table
columns: [title, status, priority, deadline, days_left]
filter: area contains '{{title}}' and status != 'done' and status != 'dropped'
sort: [priority desc, deadline]
```

## Resources

```cortex-view
source: collections/para-resources
type: table
columns: [title, kind, status, url]
filter: area contains '{{title}}' and status != 'archived'
sort: [created desc]
```

## Reviews

- {{date}} — created
