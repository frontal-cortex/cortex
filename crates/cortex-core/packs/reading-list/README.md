# Reading List

Books, articles and papers as rows, a reading note per row, and an optional
log of sittings that turns into a heatmap and a pages-per-week chart.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/reading.yaml` | `.cortex/schemas/reading.yaml` | author, status, format, genre, rating, pages, pages_read, started, finished, source, link |
| `schemas/reading-log.yaml` | `.cortex/schemas/reading-log.yaml` | `date`, `book` (a relation to the reading list), `pages` |
| `index.md` | `collections/reading/_index.md` | views: Reading now, Shelf (board by status), Finished, Per month (chart), This week (tracker) |
| `index/reading-log.md` | `collections/reading-log/_index.md` | views: Calendar, Sittings, Pages per week (chart) |
| `templates/reading.md` | `collections/reading/_template-reading.md` | New row's shape: the reading note, with the book's own heatmap and sittings at the bottom |
| `templates/reading-log.md` | `collections/reading-log/_template-reading-log.md` | the shape of a sitting: `date`, `book`, `pages` |
| `seed/reading/*.md` | `collections/reading/` | three examples: a book in progress, a finished novel, an article up next |
| `seed/reading-log/*.md` | `collections/reading-log/` | one sitting, so the week grid and chart are not empty |

The seeds are examples; edit them into your own books or delete them.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install reading-list`).
2. **Open Reading** in the sidebar and press New row. Type the title, set
   `author`, `format` and `status`. That is a complete entry; everything
   else is optional.
3. **When you finish**, set `finished`, give it a `rating` out of 5 and write
   the one-line verdict on its page. It moves to the Finished view and the
   Per month chart counts it.

## How it works

`status` is the spine: `to_read` → `up_next` → `reading` → `finished`, with
`abandoned` for the ones you put down for good. The Shelf board shows all
five columns; Reading now is only the middle one. `pages` and `pages_read`
are plain numbers you update when you put the book down. `source` is who or
what sent you to it.

Sittings live in a second collection, `reading-log`, one row each: `date`,
`book`, `pages`. They are what make the tracker and the charts work, and they
are entirely optional. With them:

- **This week** on the Reading page is a grid of the books you are currently
  reading against the days of the week; Space on a book logs a sitting today.
- Each book's page ends with a year heatmap of the days you read it and a
  table of its sittings, both filtered to that book.
- The Reading log's own page charts **pages per week** and shows the
  sittings on a calendar.

Nothing is stored twice: the grid, heatmap and charts are worked out from the
rows every time they are drawn.

## Ideas

- A yearly count: add a chart view with `x: finished`, `agg: count`,
  `bucket: year`.
- Top picks: a table view with `filter: rating == 5`, sorted by `finished desc`.
- By format: a board view with `group: format`. By genre: a table view with
  `filter: genre contains 'fiction'` (a board cannot group on a multi-select).
- Covers: a gallery view (`type: gallery`) shows each row's `cover:` image;
  put an image path in that key and add the view when you have a few.
- Rereads: a second row for the same book keeps both readings' dates and
  verdicts; the log's `book` relation can point at either.
- With the Habit Tracker pack: its Read habit answers *did I read today*;
  this log answers *what, and how much*. They do not overlap.

## Upgrading from 1.x

Version 1 had the same collection name with a star-string `rating` select and
no log. Version 2 makes `rating` a number (1–5), adds `up_next`, `genre`,
`pages`, `pages_read`, `source` and `link`, and adds the `reading-log`
collection. Existing rows keep working; rows with a `rating` of `★★★★` will
show it as text until you set a number. The 1.x Gallery view is not in the
new `_index.md` — add it back from Ideas above if you used it. `cortex packs
update` keeps any file you edited.
