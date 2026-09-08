# Daily Note

One page per day, with the parts you would want to chart kept as properties.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/journal.yaml` | `.cortex/schemas/journal.yaml` | `date`, `mood`, `energy`, `sleep`, `areas`, `highlight` |
| `index.md` | `collections/journal/_index.md` | views: Calendar, Days (table, newest first), Energy and Sleep (weekly-average line charts), Moods (count per mood) |
| `templates/journal.md` | `collections/journal/_template-journal.md` | the shape of a day: morning intention and Top 3, a timestamped log, an evening reflection, open loops |
| `seed/*.md` | `collections/journal/` | two example days, one good and one rough, both dated the day you install, so the views are not empty |

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
| Calendar | Which days did I write? Where are the gaps? |
| Days | What happened on a given day; searchable, newest first |
| Energy, Sleep | Is this month better or worse than last? One point per week, averaged, so a single bad night does not move it |
| Moods | How has the year felt, counted |

`areas` is a multi-select (work, health, family, friends, learning, creative,
money, rest). Tag the two or three a day actually touched; filter the Days
table on `areas contains 'work'` to read a month of work days in one sitting.
`highlight` is one line — the same sentence you wrote under **Highlight** in
the page — so the table and the calendar chips read as a story without
opening anything.

## Alongside other packs

- **Weekly Review** keeps one row per week in `collections/weeks/`. Its
  template starts with "read the week's daily pages": open the Days view,
  sorted newest first, and read seven.
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
- Embed a week of your own journal in any note with a fenced block:

  ```cortex-view
  source: collections/journal
  type: table
  columns: [title, mood, energy, highlight]
  sort: [date desc]
  ```

## Upgrading from 1.x

Version 1 was a single note template, `templates/daily.md`, used by the Today
button (`journal_template`). Version 2 is a collection; the days now live in
`collections/journal/` and are created with New row. The update does not
remove `templates/daily.md` — edited or not, it stays and the Today button
goes on using it — but it stops being tracked, so `cortex packs remove
daily-note` will not delete it either; delete it by hand if you want a single
place for the day. The old notes in `notes/journal/` are untouched and stay
readable. There is no automatic import of old days into the collection.
