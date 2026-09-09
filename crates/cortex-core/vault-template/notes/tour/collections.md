---
title: "Tour: Collections"
type: note
tags: [tour]
created: {{today}}
---

A collection is a folder under `collections/`. Every note in it is a row;
the note's frontmatter is the row's properties; a small YAML file under
`.cortex/schemas/` says what type each property is. No database, nothing
hidden — `grep` works on it.

This vault has one, `collections/books/`, three rows long. Here it is, live:

```cortex-views
collection: books
```

## Try

- **Switch views** with the tabs, or `Alt+1`, `Alt+2`, `Alt+3` on the
  collection's own page ([[Books]]). Each view is a few lines of YAML in that
  page's frontmatter — the same rows, arranged differently.
- **Edit in place**: click a cell. Change a `status` and the board moves the
  card; drag a card and the file's frontmatter changes.
- **Filter and sort** from the toolbar. `@today`, `@monday`, `@month` work in
  filters, so a "this week" view stays right without editing.
- **Open a row**: each is a note with a body. Click the arrow at the row's
  end. The `days` column is a formula (`finished - started`), computed when
  read and never written to the file.
- **+ New** adds a row from the collection's row template,
  `collections/books/_template-books.md`.

## Views

`table`, `board`, `calendar`, `gallery`, `chart`, `timeline` and `tracker`
(habit grids with streaks). A view spec is small enough to write by hand:

```yaml
- name: Reading now
  type: table
  columns: [title, author, started]
  filter: status == 'reading'
  sort: [started desc]
```

The collection's page ([[Books]]) is a note like any other, so you can write
around the views — how you use the list, what the statuses mean.

## Properties on any note

`Ctrl+Shift+I` shows a note's properties. Any note can carry them; a
collection just gives a folder of notes a shared schema and some views.

Next: [[Tour: Templates and packs]].
