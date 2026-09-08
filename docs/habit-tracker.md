# Habit tracker — from a bare collection to the best one there is

The Habit Tracker pack shipped in the marketplace's first batch is a table
with seven checkbox columns. It installs, it keeps history, and nobody
would use it: ticking a day takes four actions, nothing counts anything,
and there is no picture of how you are doing. This document looks at what
the best Notion habit trackers do, at what Cortex's database engine can and
cannot render today, and lays out the pack and the app features that close
the gap — in a way that leaves the app better for every other database,
not just this one.

Status 2026-09-08: built. Everything in section 4 is on the
`feat/habit-tracker` branch — checkbox cells, row templates that install and
expand placeholders, local-time dates, multi-collection packs, the `tracker`
view with its four ranges and keyboard grid, the palette's "Log habit…"
(`mod+shift+h`), `cortex set … done+=X` and `cortex tracker`, MCP `run_view`
/ `tracker` / `track`, chart `bucket:` and `series:`, and the pack at 2.0.0
(marketplace repo branch `habit-tracker-2`, vendored). Not yet done: a
clicked-through pass in the running app, and the pack's `preview.png`.

The north star applies throughout: files are truth and derived numbers are
never written into them; every file reads fine in a plain editor; the
keyboard is the primary input; an agent can log a habit as easily as a
person; and it has to be beautiful in the desktop palette.

---

## 1. What the best trackers do

Ten templates were studied — Notion's official Habit Tracker (4.6★, over a
thousand ratings), Joash's and Easlo's (4.85★, the two most-duplicated free
ones), Thomas Frank's Minimalist weekly sheet, The Sweet Setup's Ultimate,
Benny Builds It's relational tracker, the "Best Habit Tracker" heatmap,
Habit Tracker OS, ArU's yearly grid and NotionHabitHeroes. Ranked by how
often reviewers name them and how much they separate a good tracker from a
checkbox table:

| # | Feature | Who has it | What users say |
|---|---|---|---|
| 1 | **Today already exists; logging is one keystroke per habit** | Notion official (button), Sweet Setup (recurring templates), Easlo, Matthias Frank | The single thing the thousand-rating templates are praised for. Manual date creation is the top complaint elsewhere. |
| 2 | **Current and longest streak per habit** | Benny, Best Habit Tracker, NotionHabitHeroes, Notion official's streak chart | Users ask for the literal label "100 day streak". |
| 3 | **Daily completion score and "perfect day"** | Sweet Setup (progress ring + message tiers), Frank level 4, NotionHabitHeroes | |
| 4 | **Consistency heatmap / month grid with done-marks** | ArU, Best Habit Tracker, Sweet Setup calendar | The most-praised visual after streaks. |
| 5 | **Weekly grid, habits × Mon–Sun** | Thomas Frank, Gridfiti, Sweet Setup, Jglopez | The paper-tracker look; what our current pack approximates. |
| 6 | **Weekly / monthly rollups and a trend line** | Joash all-time summary, Benny, Habit Tracker OS | |
| 7 | **Frequency rules and targets** (daily, weekdays, 3×/week) | Benny, Matthias Frank, HabitZen | Cited as *the* Notion gap by tools that left Notion. |
| 8 | **Habits as records with their own page** (icon, category, notes, history) | Benny, Habit Tracker OS, Joash Pro | Adding or removing a habit never breaks a formula. |
| 9 | **A reflection slot** — weekly summary, per-day note | Thomas Frank, Sweet Setup, Grizzly | Kept by the minimal templates that dropped everything else. |
| 10 | Gamification — points, EXP, leaderboards | Kevechino, NotionHabitHeroes | Lowest impact; Frank's reviews show many want it absent. |

Recurring complaints: formulas break when a habit is added mid-month;
databases slow down after a year of daily rows; heavy templates are
abandoned within days ("two hours setting up, three days of use"); every
extra property is "a decision every time you log".

Three data models are in use:

- **A. One row per day, one checkbox per habit** (Notion official, Sweet
  Setup, Easlo). Fastest logging. Habits are schema, so changing them means
  editing the schema and every formula — the most-cited breakage. Streaks
  need cross-row access, which Notion formulas do not have; the strongest
  templates give up and compute them on a server.
- **B. One row per habit per day** with a Habits database and relations
  (Benny, Habit Tracker OS). Per-habit pages, categories, frequencies. N
  rows per day: logging touches N records, the database bloats, mobile slows.
- **C. One row per habit, one column per day or week** (Thomas Frank's
  weekly sheet, our current pack). Looks like paper. Streaks die at period
  boundaries; no date semantics; no per-day score.

Where Notion is weakest — anything computed across rows — is exactly where
a local app with the files in memory can leapfrog it.

---

## 2. What the engine can do today

From a read of `crates/cortex-core/src/data.rs`, `schema.rs`, the Tauri
`data` commands and `CortexViewBlock.tsx`:

**Works now.** Collections as folders of frontmatter rows; property types
text, number, date, checkbox, select, multi-select, status, url, person,
relation, rollup; table, board, calendar, gallery and chart views with
filter, multi-key sort and column projection; live views embedded in any
note with a `cortex-view` fence; CLI `cortex set … key=value` and MCP
`set_properties` write typed values correctly.

**Missing, and it is the whole difference.**

| Gap | Where | Effect on a habit tracker |
|---|---|---|
| **No checkbox widget in the table.** A bool cell shows "Yes"/"No"; clicking opens a text input pre-filled `true`; you retype and press Enter. | `CortexViewBlock.tsx` `renderCell` → `EditableCell` | Ticking a habit is four actions. The CLI is currently faster than the UI. |
| **No same-row or same-collection computation.** Rollups only follow a relation to *another* collection; there is no formula type. | `data.rs` `apply_rollups`, `schema.rs` | No "days done this week", no percent, no streak. |
| **Nothing renders progress.** No heatmap, streak, bar, ring or percent anywhere; the calendar shows row titles only. | grep `heatmap\|streak\|progress\|percent` → 0 | No picture of how you are doing. |
| **Charts bucket on the exact x string**, one series, line/bar only. | `data.rs` `aggregate` | No completion-by-week trend. |
| **No keyboard in the table.** No arrow movement, no Space, no Tab. | `CortexViewBlock.tsx` | Keyboard-first stops at the table's edge. |
| **Pack row templates land in the wrong place.** `templates/<coll>.md` installs to the vault's *note* templates; the table's New row menu reads `collections/<coll>/_template-*.md`. And `add_row_from_template` expands no placeholders, so `week: "{{date}}"` would be written literally. | `marketplace.rs` `destination`, `data.rs` `add_row_from_template` | Every database pack's "shape of a new row" is a dead file. A bug for all six database packs, not only this one. |
| `add_row` writes every seeded value as a string. | `data.rs` `add_row` | A blank new row cannot carry `mon: false` as a bool. |
| `today()` in the frontend is UTC. | `CortexViewBlock.tsx` | Late-evening rows get tomorrow's date east of Greenwich. |

---

## 3. The design

### 3.1 Data model: habits are records, a day is a file

Model B's flexibility with model A's logging speed, as plain files:

```
collections/habits/                 # one row per habit — a real note with a page
├── _index.md                       # views (below)
├── exercise.md
├── read.md
└── sleep-by-11.md

collections/habit-log/              # one file per day
├── _index.md
├── 2026-09-07.md
└── 2026-09-08.md
```

```yaml
# collections/habits/exercise.md
---
title: Exercise
icon: 🏃
category: health                    # select, coloured
frequency: daily                    # daily | weekdays | weekly | custom
target: 5                           # per week; used by weekly/custom
start: 2026-09-01
archived: false
created: "2026-09-01"
---
Why this habit matters, what counts, what does not. The page is the
habit's home: its streak and history render here (§3.3).
```

```yaml
# collections/habit-log/2026-09-08.md
---
title: 2026-09-08
date: 2026-09-08
done: [Exercise, Read]              # relation → collections/habits
created: "2026-09-08"
---
Slept badly, skipped the run, read on the train.
```

Why this shape:

- **One tick = one line.** Toggling a habit edits the `done:` list in one
  file; the diff is one line in one file (principle 5). Model B proper
  would touch N files a day.
- **Adding a habit is adding a note**, not editing a schema or a formula —
  the failure mode every Notion review complains about is gone.
- **A missing day is a day with nothing done.** No recurring template, no
  scheduler: the log file is created on the first tick. "Today already
  exists" for free.
- **Readable anywhere.** `done: [Exercise, Read]` under a date is the most
  legible habit record there is; Obsidian shows it as properties, GitHub
  as YAML.
- **Every derived number — streaks, percentages, heatmaps — is a pure
  function over these files**, computed on read and never written
  (principle 2). This is the part Notion cannot do and we can.
- **The per-day body is the reflection slot** (feature 9), and the
  Weekly Review template can embed the week (§3.4).
- The relation stores habit *titles*, as relations already do. Renaming a
  habit is a rename across log files; the existing rename machinery
  handles wiki-link style references and a follow-up can extend it here.

Rejected: keeping the log in the daily journal note's frontmatter. It
saves a file per day, but journals are per-user under `notes/journal/`,
are not a collection, and would put a typed list in a free-form note. The
daily note *embeds* the tracker instead (§3.4), which gives the same
"log from Today" experience.

### 3.2 The tracker view — one new generic view type

A new view type, `tracker`, alongside table, board, calendar, gallery and
chart. It is not habit-specific: it renders **items × periods, with a
membership mark in each cell**, where items come from one collection and
each period's membership is a list property in another. Reading days,
workout types, medication, watering plants — same view.

```yaml
# collections/habits/_index.md
views:
- name: Today
  type: tracker
  log: collections/habit-log        # the periods
  date: date                        # the log's date property
  done: done                        # the log's list property naming items
  range: today                      # today | week | month | year
- name: This week
  type: tracker
  log: collections/habit-log
  date: date
  done: done
  range: week
- name: Year
  type: tracker
  log: collections/habit-log
  date: date
  done: done
  range: year                       # the heatmap
- name: Habits
  type: table
  columns: [title, category, frequency, target, archived]
```

The backend command `run_tracker` reads both collections once and returns,
per item: its row, and for the range a vector of `{ date, done }`, plus
**computed** `current_streak`, `longest_streak`, `this_week` (done/target),
`rate_30d`; and per period a `score` (done/expected) and `perfect: bool`.
Frequency semantics, version one:

| `frequency` | expected on a day | streak counts |
|---|---|---|
| `daily` | every day | consecutive days done |
| `weekdays` | Mon–Fri | consecutive weekdays done; weekends neither break nor extend |
| `weekly` / `custom` with `target: n` | any `n` days per ISO week | consecutive weeks that met the target; the current week shows `3/5` |

Today's not-yet-done never breaks a streak until the day is over.
Archived habits and habits whose `start` is after a date are not expected
on it.

**Rendering, by range:**

- **today** — a single column: icon, habit name, a large checkbox, the
  streak as a label ("12-day streak", muted "3/5 this week"). A completion
  line at the top: "2 of 4 · 50%" with a thin bar; "Perfect day" when full.
  This is the block the daily note embeds.
- **week** — habits × Mon–Sun, today's column highlighted, per-row streak
  and week score at the right, per-column day score at the bottom. The
  paper-tracker look (feature 5) with the numbers (features 2, 3).
- **month** — habits × days of the month as small marks; a month score.
- **year** — a GitHub-style heatmap per habit, or one combined heatmap
  coloured by the day's score, with the longest streak marked (feature 4).

**Keyboard** (the view is a roving grid like the sidebar): `j`/`k` move
between habits, `h`/`l` between days, `Space` or `Enter` toggles the cell,
`t` jumps to today, `1`–`9` toggle the n-th habit for today, `Escape`
leaves the grid. Toggling writes the one line in the log file and the
numbers update in place.

**Colour** comes from the semantic tokens: marks in `--accent`, the heatmap
as `color-mix` steps of the accent over `--bg-panel`, streak labels in
`--text-secondary`, the perfect-day line in `--git-clean`. Nothing
hardcoded, so Omarchy palettes carry through.

Why a view and not a formula engine: a formula property would be a large,
schema-heavy feature (parser, types, cross-row references) that the roadmap
already defers, and it would still not give a heatmap. The tracker view
delivers features 1–5 and 7 with one backend command and one component,
and stays generic. Formulas remain on the roadmap; when they land, the
tracker's numbers can be exposed as read-only properties too.

### 3.3 The habit's own page

A habit row is a note, so opening `Exercise` shows its page. The row
template body embeds the tracker filtered to that habit:

````markdown
```cortex-view
source: collections/habits
type: tracker
log: collections/habit-log
date: date
done: done
range: year
filter: title == '{{title}}'
```
````

That is feature 8 — per-habit history, streaks and notes — with no new
machinery beyond §3.2 and the placeholder fix in §4.

### 3.4 Entry points that make it a daily habit

- **Today** (`mod+shift+t`): the daily note template gains an optional
  tracker block at the top (`range: today`). The pack ships a
  `templates/daily-with-habits.md`; the Marketplace's install report tells
  the user to set `journal_template` to it, or a one-click "Use for Today"
  in the pack page.
- **Weekly Review**: the review template embeds `range: week`, so the
  reflection happens next to the numbers.
- **Command palette**: "Log habit…" lists habits with today's state;
  Enter toggles. Fast enough to do with the eyes closed.
- **Quick capture**: `mod+shift+k` already appends to today's note; a
  leading `✓ exercise` or `done exercise` toggles the habit instead.
  (Later; not needed for version one.)

### 3.5 Agents and the CLI

An agent told "I ran this morning" should need one call.

- **CLI:** list operations on `cortex set`: `done+=Exercise` adds to a list
  property, `done-=Exercise` removes. Then
  `cortex set collections/habit-log/2026-09-08 done+=Exercise` — and the
  file is created from the log's row template if it does not exist.
  `cortex habits` (or `cortex tracker <view>`) prints the week grid as text,
  with streaks; `--json` for agents.
- **MCP:** the existing `set_properties` already writes typed lists. Add
  `run_view` so an agent can read the tracker's computed numbers ("what is
  my longest streak?") instead of recomputing from rows; it is useful for
  every view type.
- **AGENTS.md** in the pack's README explains the two collections in three
  lines, so an agent reading the vault knows what `done:` means.

### 3.6 What the pack ships — shipped as `habit-tracker` 2.0.0 (marketplace branch `habit-tracker-2`)

```
habit-tracker/
├── manifest.yaml                    # version 2.0.0, kind: collection, collection: habits, collections: [habit-log]
├── README.md
├── preview.png                      # the week grid in the default palette
├── schemas/habits.yaml              # title, icon, category (select), frequency (select), target (number), start (date), archived (checkbox)
├── schemas/habit-log.yaml           # date (date), done (relation → habits)
├── index.md                         # habits/_index.md: Today, This week, Year, Habits (table)
├── log-index.md                     # habit-log/_index.md: Calendar (date), Table  ← needs the multi-collection pack format (§5)
├── templates/habits.md              # row template: frequency: daily, target: 7, archived: false, body embeds the habit's year tracker
├── templates/habit-log.md           # row template: done: []
├── templates/daily-with-habits.md   # note template: today's tracker block, then the daily note's headings
└── seed/habits/exercise.md, read.md, sleep-by-11.md   # three habits; no log seeds — the first tick creates today
```

Three seeded habits and no demo log follows Easlo's most-praised trait:
nothing to delete before it is yours.

---

## 4. App work, in order

Each item is generic; the habit tracker is the first user.

| # | Work | Where | Effort | Unblocks |
|---|---|---|---|---|
| 1 | **Checkbox cells**: render a real checkbox for bool columns, one click toggles, `Space` toggles when focused; write a typed bool. | `CortexViewBlock.tsx` `renderCell`, new `CheckboxCell` | S | every database with a checkbox |
| 2 | **Pack row templates**: `destination()` maps `templates/<coll>.md` → `collections/<coll>/_template-<coll>.md` for collection packs; `add_row_from_template` expands `{{date}} {{time}} {{title}} {{uuid}}`; `add_row` keeps typed seeds. Bump the six database packs. | `marketplace.rs`, `data.rs` | S | all database packs |
| 3 | **Local-time `today()`** in the frontend, matching the calendar. | `CortexViewBlock.tsx` | XS | correctness |
| 4 | **Multi-collection packs**: a collection pack may declare `collections: [habits, habit-log]` with `schemas/<c>.yaml`, `index/<c>.md`, `templates/<c>.md`, `seed/<c>/*.md` per collection. Lint and install extend naturally; single-collection packs keep the current layout. | `marketplace.rs`, marketplace repo lint | M | this pack, Contacts + Interactions later |
| 5 | **`tracker` view**: `run_tracker` in core (items, periods, streaks, scores; frequency rules), Tauri command, `TrackerView` with today/week/month/year renderings, keyboard grid, toggle → `set_cell` on the log file (creating it from the row template when absent). View spec keys `log`, `date`, `done`, `range`; `parseViews`/`viewToFrontmatter` learn them; the toolbar gets a range switcher. Tests on streak semantics. | `data.rs` or new `tracker.rs`, `commands/data.rs`, `CortexViewBlock.tsx`, `database.ts`, `DataViews.tsx` | L | features 1–5, 7, 8 |
| 6 | **Palette "Log habit…"** and the pack's daily note template. | `QuickSwitcher.tsx`, pack | S | feature 1's "one keystroke" |
| 7 | **CLI list ops** `key+=v` / `key-=v`, create-from-row-template on a missing log file; `cortex tracker <view>` text rendering; MCP `run_view`. | `cortex-cli/ops.rs`, `mcp.rs` | S–M | agents |
| 8 | **Chart bucketing**: `bucket: day\|week\|month\|year` on the chart spec, applied to date-typed x before grouping; `series:` for a second grouping (one line per habit). | `data.rs` `aggregate`, `MiniChart` | M | feature 6, and every chart over dates |
| 9 | Habit page block, Weekly Review embed, README, docs, the `habit-tracker` pack at 2.0.0 in the marketplace repo, screenshots for the preview. | pack repo, `docs/` | S | ship |

Rough total: five to six days. Items 1–3 are half a day and worth doing
first regardless of the rest; item 5 is the centrepiece and the only large
one; item 8 can trail.

### Sequencing

1. **PR A — table basics** (1, 2, 3): checkbox cells, row templates that
   actually install, local dates. Ships alone; improves Tasks, Reading
   List, Budget and Projects immediately.
2. **PR B — tracker view** (4, 5, 6): the pack format extension, the view,
   the palette command, and the pack rewritten to the new model, tested end
   to end on the test vault.
3. **PR C — agents and charts** (7, 8, 9): CLI list ops, `run_view` over
   MCP, chart buckets, the docs and the marketplace release.

Items 5 and 8 want the same design pass the Settings and Marketplace pages
had: a mockup of the week grid and the heatmap in the default and one dark
Omarchy palette before the CSS is written.

---

## 5. Decisions to confirm

- **The data model** (§3.1): habits as rows, one log file per day with a
  `done:` list. The alternative is one row per habit per day (Benny's
  model), which reads worse, diffs worse and is slower to log, but needs no
  list-property toggling. Recommendation: the day file.
- **Two collections in one pack** (item 4) rather than a bundle of two
  packs. A bundle would install and version them separately, which makes no
  sense for a log that means nothing without its habits. Recommendation:
  extend the pack format; it is a small, backwards-compatible change.
- **A `tracker` view rather than formulas**. Formulas stay on the roadmap;
  the view is the shortest path to streaks, scores and a heatmap and stays
  generic. Recommendation: the view.
- **Frequency rules in version one**: daily, weekdays, and a weekly target.
  Specific weekdays ("Mon/Wed/Fri") and monthly targets wait for a second
  pass; both fit the same `frequency`/`target` fields plus a `days:` list.
- **The daily note**: ship a second template and let the user switch
  `journal_template`, rather than editing the user's existing daily
  template on install. Recommendation: never edit their template.
- **No gamification** in the pack. A points system can be a community
  pack over the same two collections later.
- **Name.** The pack stays `habit-tracker`; the version goes to 2.0.0
  because the collection layout changes. `update` from 1.x cannot migrate
  the old week rows automatically; the pack page says so and offers to
  keep the old `habits` collection as `habits-old`.
