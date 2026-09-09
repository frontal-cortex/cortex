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

Each piece as a bar from its draft deadline (`due`) to the day it goes out
(`publish`); a piece with only one of the two is a dot.

```cortex-view
source: collections/content
type: timeline
start: due
end: publish
filter: campaign contains '{{title}}'
```

## Retro

What worked, what did not, what to keep for next time.
