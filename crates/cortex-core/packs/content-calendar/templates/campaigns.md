---
title: "{{title}}"
type: note
tags: []
status: planning
start: "{{date}}"
end:
goal:
created: "{{date}}"
---

## Pieces

Every piece whose `campaign` is this one, by status. Add pieces in Content
and pick this campaign in their `campaign` property.

```cortex-view
source: collections/content
type: board
group: status
filter: campaign contains '{{title}}'
```

## Schedule

```cortex-view
source: collections/content
type: table
columns: [title, channel, format, status, due, publish]
filter: campaign contains '{{title}}'
sort: [publish]
```

## Retro

What worked, what did not, what to keep for next time.
