---
title: Finances
type: note
tags: []
icon: 💰
category: finances
status: active
standard: "Bills paid on time, savings rate above 20%, taxes filed before the deadline."
review: monthly
next_review: "{{today}}"
created: "{{today}}"
---

## Standard

Bills paid on time, savings rate above 20%, taxes filed before the deadline.

## Projects

```cortex-view
source: collections/para-projects
type: table
columns: [title, status, priority, deadline]
filter: area contains 'Finances' and status != 'done' and status != 'dropped'
sort: [deadline]
```

## Resources

```cortex-view
source: collections/para-resources
type: table
columns: [title, kind, status, url]
filter: area contains 'Finances' and status != 'archived'
sort: [created desc]
```

## Reviews

- {{today}} — Review monthly, right after payday. The tax return is planned; the fund comparison is still in the inbox.
