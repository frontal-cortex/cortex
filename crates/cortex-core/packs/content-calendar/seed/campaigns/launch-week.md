---
title: "Launch week"
type: note
tags: []
status: active
start: "{{today}}"
end:
goal: Five pieces across three channels in one week, all pointing at the same page.
created: "{{today}}"
---

An example campaign: two of the seeded pieces belong to it, so the board and
schedule below are already filled. Set `end` to the Friday, then rename it or
delete it once you have your own.

## Pieces

```cortex-view
source: collections/content
type: board
group: status
filter: campaign contains 'Launch week'
```

## Schedule

```cortex-view
source: collections/content
type: table
columns: [title, channel, format, status, due, publish]
filter: campaign contains 'Launch week'
sort: [publish]
```

## Retro

What worked, what did not, what to keep for next time.
