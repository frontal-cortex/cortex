# Daily Note

One page per day, with the parts you would want to chart kept as properties.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/journal.yaml` | `.cortex/schemas/journal.yaml` | `date`, `mood`, `energy` (stars, 1–5), `sleep` (hours), `areas`, `highlight`, `week` (the week's row in Weekly Review) |
| `index.md` | `collections/journal/_index.md` | views: This week (the days since Monday, in order), Calendar, Days (table, newest first), Energy and Sleep (weekly-average line charts), Moods (each month's days stacked by mood) |
| `templates/journal.md` | `collections/journal/_template-journal.md` | the shape of a day: morning intention and Top 3, a timestamped log, an evening reflection, open loops |
| `seed/*.md` | `collections/journal/` | two example days, one good and one rough — last Sunday and this Monday, so This week, the calendar and the weekly charts all show something on install |

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install daily-note`).
2. **Open Journal** in the sidebar and press New row. The page is titled with
   today's date and the first log line already carries the time. Write the
   intention and three priorities; leave the rest.
3. **Come back tonight.** Fill the evening prompts, then set `mood`, `energy`
   (1–5) and `sleep` (hours) in the properties. Delete the two example days
   when you have a real one.

That is the whole routine: thirty seconds of properties, a few minutes of
page. The template deliberately has few sections — a journal that takes ten
minutes stops after a fortnight.

To make the **Today** button (`mod+shift+t`) open this journal, set
`journal_template` to `collections/journal` in Settings → Notes (or
`cortex settings set journal_template=collections/journal`). Today then opens
the day's row, creating it from the row template the first time. Left at
its default, Today keeps making plain notes in `notes/journal/` and a day
here is made with New row — use one or the other, not both.

## How it works

Every day is a file in `collections/journal/` named by its date. The
properties in the frontmatter are what the views read:

| View | Question it answers |
|---|---|
| This week | What has this week been so far? Monday first — the pages to read before a weekly review |
| Calendar | Which days did I write? Where are the gaps? |
| Days | What happened on a given day; searchable, newest first |
| Energy, Sleep | Is this month better or worse than last? One point per week, averaged, so a single bad night does not move it |
| Moods | How did each month feel? One bar per month, stacked by mood, best to worst |

This week is `date >= @monday`, so it rolls over on its own; on a Monday
morning it holds one page, on Sunday evening seven. `energy` shows as stars
out of five and `sleep` as hours with one decimal; both chart by week. A
select charts and sorts in the order its options are declared, so the Moods
bars stack great → rough rather than alphabetically.

`areas` is a multi-select (work, health, family, friends, learning, creative,
money, rest). Tag the two or three a day actually touched; filter the Days
table on `areas contains 'work'` to read a month of work days in one sitting.
`highlight` is one line — the same sentence you wrote under **Highlight** in
the page — so the table and the calendar chips read as a story without
opening anything.

`week` is a relation to Weekly Review's `collections/weeks`, by row title.
The template fills it with "Week of" and this week's Monday, which is what
that pack titles its rows, so a day made from the template already belongs
to its week. Without Weekly Review installed it is a name that points
nowhere and costs nothing; delete the property from the schema if it
bothers you.

## Alongside other packs

- **Weekly Review** keeps one row per week in `collections/weeks/`. Its
  review starts with "read the week's daily pages": that is the This week
  view. Through `week` it also counts the days you wrote and averages
  `energy` and `sleep` per week — columns in its Weeks table, computed from
  here, nothing to copy.
- **Habit Tracker** keeps habits in their own log with a Today view; this
  journal does not duplicate them. If you want today's habits at the top of
  the day, that pack's `daily-with-habits.md` is a note template for the
  Today button and works alongside this collection.

## Ideas

- Add `cover:` to a day's frontmatter with a photo and add a Gallery view
  (`type: gallery`) to the index — a wall of the days you photographed.
- Add a `workout` checkbox or a `weight` number to the schema and a chart on
  it; anything numeric charts by week with the same four lines (`x`, `y`,
  `agg`, `bucket`) as Energy.
- A month of days on one page: a table with `filter: date >= @month`; last
  month's with `date >= @month-1 and date < @month`.
- Embed the week in any note — a weekly review, a dashboard — with a fenced
  block:

  ```cortex-view
  source: collections/journal
  type: table
  columns: [title, mood, energy, highlight]
  filter: date >= @monday
  sort: [date]
  ```

## Upgrading from 2.0

The days you have are untouched. New: a This week view; the Moods chart is
now one bar per month rather than one count for all time; `energy` shows as
stars; and the schema has a `week` relation that new days fill in from the
template. Days written before this version have no `week` — set it to
"Week of" and that week's Monday if you want them counted in Weekly
Review's averages, or leave them. If you edited `_template-journal.md`, the
update keeps your copy; add the `week:` line from the new template by hand.

## Upgrading from 1.x

Version 1 was a single note template, `templates/daily.md`, used by the Today
button (`journal_template`). Version 2 is a collection; the days now live in
`collections/journal/` and are created with New row. The update does not
remove `templates/daily.md` — edited or not, it stays and the Today button
goes on using it — but it stops being tracked, so `cortex packs remove
daily-note` will not delete it either; delete it by hand if you want a single
place for the day. The old notes in `notes/journal/` are untouched and stay
readable. There is no automatic import of old days into the collection.
