---
title: "Tour: Linking"
type: note
tags: [tour, tour/linking]
created: {{today}}
---

A pile of notes is a folder. Links make it a brain.

## Wiki links

Type two square brackets and start a title: `[[Second Brain]]` links to that note. Links
resolve by title, then by file name, so renaming a file does not break them,
and renaming a note rewrites every link that points at it.

- A section: [[Second Brain#Why links matter]]
- Shown differently: [[Second Brain|the note on linking]]
- Embedded whole, with an exclamation mark in front of the link:

![[Second Brain]]

## Backlinks

Open [[Second Brain]] now. At the bottom, **Linked from** lists this page —
every note that mentions it, kept up to date without you doing anything.
That is how an idea gathers its context over time.

## Tags

`tags:` in the frontmatter, or `#inline` in the text, both count. A slash
nests: this page carries `tour/linking`, so it shows under `tour` and under
`tour/linking` in the sidebar's **Tags** section. Click a tag to see every
note with it. #tour

## The graph

`Ctrl+G` draws every note and every link. `Ctrl+Shift+G` shows only the
neighbourhood of the note you are on — useful when a page has grown a lot of
connections.

## Search

`Ctrl+K` finds notes by title as you type. Full-text search is in the
sidebar's search box and understands a little syntax:

    "exact phrase"   -notthis   tag:tour   type:note   path:tour/

Results come from a local index the app rebuilds on its own; deleting
`.brain/` costs nothing but a moment.

Next: [[Tour: Daily notes]].
