---
title: "{{title}}"
type: note
tags: []
category: personal
status: active
standard:
review: monthly
next_review: "{{date}}"
created: "{{date}}"
---

## Standard

What "good" looks like in this area, in one or two sentences. This is what a
review checks against.

## Projects

```cortex-view
source: collections/para-projects
type: table
columns: [title, status, priority, deadline]
filter: area contains '{{title}}' and status != 'done' and status != 'dropped'
sort: [deadline]
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
