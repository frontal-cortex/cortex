---
title: "{{title}}"
type: note
tags: [book]
author:
status: to_read
format: book
genre: []
rating:
pages:
pages_read:
started:
finished:
source:
link:
cover:
created: "{{date}}"
---

## Why I picked this up

Who recommended it, or what question sent you to it.

## Key ideas

-

## Quotes worth keeping

>

## Verdict

One line, and how you will use what you read. Set `status` to `finished` —
that stamps the `finished` date — and give it a `rating` out of 5.

## Sittings

```cortex-view
source: collections/reading
type: tracker
log: collections/reading-log
date: date
done: book
range: year
filter: title == '{{title}}'
```

```cortex-view
source: collections/reading-log
type: table
columns: [date, pages, title]
filter: book contains '{{title}}'
sort: [date desc]
```
