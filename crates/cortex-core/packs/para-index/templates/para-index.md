---
title: "Second Brain"
type: note
tags: [para, index]
created: "{{date}}"
---

Everything you keep is in one of four buckets, sorted by how actionable it is
right now, not by topic. This page reads the three databases live; there is
nothing to update here by hand.

## Projects

*Short efforts with a deadline and a defined outcome.*

```cortex-view
source: collections/para-projects
type: board
group: status
filter: status != 'done' and status != 'dropped'
```

## Areas

*Ongoing responsibilities with no end date, each with a standard to keep.*

```cortex-view
source: collections/para-areas
type: table
columns: [title, category, standard, review, next_review]
filter: status != 'archived'
sort: [next_review]
```

## Resources

*Reference material with no commitment attached. The ten most recent.*

```cortex-view
source: collections/para-resources
type: table
columns: [title, kind, area, project, status]
filter: status != 'archived'
sort: [created desc]
limit: 10
```

## Archive

*Finished or dropped projects. Archived areas and resources are in their own
Archive views.*

```cortex-view
source: collections/para-projects
type: table
columns: [title, area, status, completed]
filter: status == 'done' or status == 'dropped'
sort: [completed desc]
limit: 10
```

---

**Weekly review:** empty the Resources inbox, move finished projects to
`done` (set `completed`), start the next planned one, and push each area's
`next_review` forward once you have looked at it.
