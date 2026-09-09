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

*Due inside two weeks, or already late:*

```cortex-view
source: collections/para-projects
type: table
columns: [title, area, priority, deadline, days_left]
filter: deadline <= @today+14 and status != 'done' and status != 'dropped'
sort: [deadline]
```

## Areas

*Ongoing responsibilities with no end date, each with a standard to keep.*

```cortex-view
source: collections/para-areas
type: table
columns: [title, category, standard, open_projects, next_review, review_in]
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

**Weekly review:** empty the Resources inbox, set finished projects to `done`
(the `completed` date fills itself in), start the next planned one, and for
each area whose `review_in` has reached zero, look at it and set
`next_review` to the next date.
