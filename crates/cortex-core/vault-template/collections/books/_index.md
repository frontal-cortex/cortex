---
title: Books
type: database
icon: 📚
tags: [tour]
created: {{today}}
views:
- name: Shelf
  type: table
  columns: [title, author, status, format, rating, days]
  sort: [status, started desc]
- name: By status
  type: board
  group: status
- name: Reading over time
  type: timeline
  start: started
  end: finished
  filter: started != ''
---

Three rows, so the [[Tour: Collections]] has something to show. Each row is
a note in `collections/books/`; this page is the collection's own — its
views live in the frontmatter above, and this text is yours to keep or
replace.

`status` moves a book across the board. `days` is a formula, `finished -
started`, worked out when the table is read. **+ New** adds a row shaped by
`_template-books.md` in the same folder.

Delete the folder when you no longer need it, or install the Reading List
pack from the marketplace for the full version.
