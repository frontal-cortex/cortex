---
title: "{{title}}"
type: note
tags: []
status: idea
channel:
format:
pillar: []
priority: medium
due:
publish:
owner:
campaign: []
link:
repurposed_from: []
created: "{{date}}"
---

## Brief

- **Audience:** who this is for, in one line
- **Promise:** what they get from it, in one sentence
- **Call to action:** what they should do at the end

## Outline

1.
2.
3.

## Draft

## Before publishing

- [ ] Title and first line read aloud
- [ ] Links and names checked
- [ ] Image or thumbnail added
- [ ] `publish` date set, status → scheduled

## After publishing

- [ ] `link` filled in, status → published
- [ ] What to cut from this: a thread, a short, a newsletter section

## Made from this

```cortex-view
source: collections/content
type: table
columns: [title, channel, format, status, publish]
filter: repurposed_from contains '{{title}}'
sort: [publish desc]
```

## Notes

How it did, what you would change, replies worth keeping.
