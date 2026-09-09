---
title: "Launch week"
type: note
tags: []
status: active
start: "{{today-3}}"
end: "{{today+4}}"
goal: Five pieces across three channels in one week, all pointing at the same page.
created: "{{today}}"
---

An example campaign, already under way: three of the seeded pieces belong to
it — one published, one scheduled, one still drafting — so `shipped` reads 1,
`progress` a third, and the board and schedule below are filled. Rename it or
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
type: timeline
start: due
end: publish
filter: campaign contains 'Launch week'
```

## Retro

What worked, what did not, what to keep for next time.
