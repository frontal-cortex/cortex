# Reading List

Books, articles and papers as rows, a reading note per row, a progress bar
per book, and an optional log of sittings that turns into a heatmap and a
pages-per-week chart.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/reading.yaml` | `.cortex/schemas/reading.yaml` | author, status, format, genre, rating (stars), pages, pages_read, logged, progress, last_read, days_idle, started, finished, read_until, days_to_finish, source, link |
| `schemas/reading-log.yaml` | `.cortex/schemas/reading-log.yaml` | `date`, `book` (a relation to the reading list), `pages` |
| `index.md` | `collections/reading/_index.md` | views: Reading now, Shelf (board by status), Finished, Per month (chart), Timeline, This week (tracker) |
| `index/reading-log.md` | `collections/reading-log/_index.md` | views: Calendar, Sittings, Pages per week (chart, one colour per book) |
| `templates/reading.md` | `collections/reading/_template-reading.md` | New row's shape: the reading note, with the book's own heatmap and sittings at the bottom |
| `templates/reading-log.md` | `collections/reading-log/_template-reading-log.md` | the shape of a sitting: `date`, `book`, `pages` |
| `seed/reading/*.md` | `collections/reading/` | four examples: a book in progress, a novel finished two days ago, one finished last month, an article up next |
| `seed/reading-log/*.md` | `collections/reading-log/` | five sittings over the last two weeks, so the week grid, the heatmaps and the chart have a shape on install |

The seeds are examples; edit them into your own books or delete them.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install reading-list`).
2. **Open Reading** in the sidebar and press New row. Type the title, set
   `author`, `format` and `status`. That is a complete entry; everything
   else is optional.
3. **When you start**, move `status` to `reading` — `started` is stamped
   with today. Set `pages` if you want a progress bar.
4. **When you finish**, move `status` to `finished` — `finished` is stamped
   — give it a `rating` out of 5 and write the one-line verdict on its page.
   It moves to the Finished view, the Per month chart counts it and the
   Timeline draws it.

## How it works

`status` is the spine: `to_read` → `up_next` → `reading` → `finished`, with
`abandoned` for the ones you put down for good. The Shelf board shows all
five columns; Reading now is only the middle one. `source` is who or what
sent you to it.

| Property | What it is for |
|---|---|
| `started`, `finished` | dates you never type: `started` fills in the day `status` becomes `reading`, `finished` the day it becomes `finished`. Both stay editable. |
| `pages`, `pages_read` | the page count, and your bookmark. Update `pages_read` when you put the book down, or leave it and log sittings instead. |
| `logged` | the pages summed from this book's sittings in the log. Read-only. |
| `progress` | `pages_read` or `logged`, whichever is further, over `pages`, as a bar. Empty until `pages` is set. |
| `last_read`, `days_idle` | the date of the latest sitting, and how many days ago that was. Reading now is sorted by `last_read`, so the book you have neglected longest is at the top; a book with no sittings sits at the bottom. Empty without the log. |
| `read_until` | `finished`, or today while the book is still open. Only the Timeline uses it, as the end of each bar. |
| `days_to_finish` | `finished` minus `started`, shown in the Finished view. |
| `rating` | 1–5, shown as stars. |

Sittings live in a second collection, `reading-log`, one row each: `date`,
`book`, `pages`. They are what make the tracker, the heatmaps, `logged` and
`last_read` work, and they are entirely optional. With them:

- **This week** on the Reading page is a grid of the books you are currently
  reading against the days of the week; Space on a book logs a sitting today.
- Each book's page ends with a year heatmap of the days you read it and a
  table of its sittings, both filtered to that book.
- The Reading log's own page charts **pages per week**, one colour per book,
  and shows the sittings on a calendar.

Nothing is stored twice: the bars, sums, grid, heatmap and charts are worked
out from the rows every time they are drawn, and none of them is written to
a file.

The **Timeline** shows every book you have started as a bar from `started`
to `read_until` — the day you finished, or today for the ones still open —
so a year of reading is one horizontal picture, with the current book
running up to the today line. Rows with no `started` date (to read, up next)
are left out.

## Ideas

- This year only: add `and finished >= @year` to the Finished view's filter,
  or a chart view with `x: finished`, `agg: count`, `bucket: year`.
- Stalled: a table with `filter: status == 'reading' and last_read < @today-14`.
- Top picks: a table view with `filter: rating == 5`, sorted by `finished desc`.
- By format: a board view with `group: format`. By genre: a table view with
  `filter: genre contains 'fiction'` (a board cannot group on a multi-select).
- Pages per month instead of per week: change the log chart's `bucket`.
- Covers: a gallery view (`type: gallery`) shows each row's `cover:` image;
  put an image path in that key and add the view when you have a few.
- Rereads: a second row for the same book keeps both readings' dates and
  verdicts; the log's `book` relation can point at either.
- With the Habit Tracker pack: its Read habit answers *did I read today*;
  this log answers *what, and how much*. They do not overlap.

## Upgrading from 2.0

Nothing to migrate. 2.1 adds computed properties (`logged`, `progress`,
`last_read`, `days_idle`, `read_until`, `days_to_finish`) that are worked out on read,
`auto` stamps on `started` and `finished`, star and integer formats, a
Timeline view, a per-book series on the pages chart, and more sittings in
the seeds. Existing rows keep working; a book whose `started` you never set
gets it the next time you move its status. `cortex packs update` keeps any
file you edited.

## Upgrading from 1.x

Version 1 had the same collection name with a star-string `rating` select and
no log. Version 2 makes `rating` a number (1–5), adds `up_next`, `genre`,
`pages`, `pages_read`, `source` and `link`, and adds the `reading-log`
collection. Existing rows keep working; rows with a `rating` of `★★★★` will
show it as text until you set a number. The 1.x Gallery view is not in the
new `_index.md` — add it back from Ideas above if you used it.
