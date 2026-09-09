# Meeting Notes

Meetings as rows, action items as rows of their own, linked back to the
meeting they came from.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/meetings.yaml` | `.cortex/schemas/meetings.yaml` | date, kind, status, repeat, attendees, project, summary, link; computed `open_items` and `progress` |
| `schemas/action-items.yaml` | `.cortex/schemas/action-items.yaml` | meeting (relation), owner, due, status, `completed` (stamped), computed `days_left` |
| `index.md` | `collections/meetings/_index.md` | views: All, This week, Upcoming, To write up, Calendar, Follow-up (board), Per week (chart) |
| `index/action-items.md` | `collections/action-items/_index.md` | views: Open, Overdue, This week, Mine, Board, Due (calendar), By week (chart) |
| `templates/meetings.md` | `collections/meetings/_template-meetings.md` | New row's shape for a meeting: agenda, notes, decisions, action items with a live table, open questions, next meeting |
| `templates/action-items.md` | `collections/action-items/_template-action-items.md` | New row's shape for an action item: context and outcome |
| `seed/*.md` | `collections/meetings/` | three example meetings: a weekly sync from last week (followed up, repeating), a review yesterday still to write up, a client kickoff in three days |
| `seed/action-items/*.md` | `collections/action-items/` | one done, one overdue, one due tomorrow, each linked to its meeting |

Action items nest under Meetings in the sidebar. The seeds are dated relative
to the day you install, so the calendar, the week views and the charts show a
shape from the first open.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install meeting-notes`).
2. **Open Meetings** and press New row. Name it, and the page opens with today's
   date and time filled in and the headings ready. Set `kind`, and add the
   agenda before the meeting if you can. For a standing meeting, set `repeat`.
3. **After the meeting**, write the one-line `summary`, set `status` to
   `held`, and give each action item a row: New row in Action items, pick the
   `meeting`, set `owner` and `due`. When they are all logged, mark the meeting
   `followed-up`.

Delete the three example meetings and their action items when you no longer
need the shape in front of you.

## How it works

- **A meeting is a row and a page.** The row holds what you filter on; the
  page holds what you read later. All sorts by date, newest first, and shows
  the summary next to `open_items` and `progress`, so scanning a month of
  meetings takes seconds. This week lists Monday to Sunday; Upcoming lists
  what is still `scheduled` from today on, with the call link one click away;
  the Calendar answers "when did we talk about that?".
- **To write up** is every meeting whose date has passed while its row still
  says `scheduled`. It is the list to clear at the end of the day; an empty
  view means every meeting that happened has been marked `held` or
  `cancelled`.
- **Status is a follow-up checklist.** `scheduled` → `held` → `followed-up`.
  The Follow-up board shows every meeting whose action items have not been
  logged and handed out yet. `cancelled` keeps the row so the gap is visible.
  `followed-up` is the last option on purpose: that is what tells a repeating
  meeting it is finished.
- **Standing meetings repeat.** Set `repeat` to `weekly`, `biweekly`,
  `monthly` or `quarterly` and, when the meeting is marked `followed-up`, the
  next occurrence is written as a new row: the same title and page, `date`
  moved on by the interval, `status` back to `scheduled`. The old row stays as
  history. Because the title carries over, action items that name the meeting
  show on every occurrence's page; rename an occurrence (add the date) if you
  want them apart.
- **Action items live in their own list.** Each has one owner, a due date and
  a status, and a `meeting` relation. The meeting's page embeds its own items
  (a `cortex-view` block filtered to that meeting), and the Action items page
  shows everything open across all meetings. `days_left` is computed from
  `due` and goes negative once the date has passed; Overdue is the rows where
  it has. Mine filters `owner` to `@me`: the vault member matching your git
  name or email. When an item reaches `done`, `completed` is stamped with the
  day — you never type it.
- **Counts on the meeting.** `open_items` is how many of a meeting's items are
  neither done nor dropped; `progress` is the share that are, drawn as a bar.
  Both are computed from the Action items list on read, never stored, so they
  cannot go stale.
- **Charts.** Per week counts meetings by kind, so a month of `client` bars
  next to `standup` bars says something about where the time went. By week on
  the action items list counts items by due week and status.

## Ideas

- Add a `series` text property to the meetings schema if you want a view per
  standing meeting; filter All by it.
- Use the same `project` names as in the Project Tracker pack, and a filter
  such as `project == 'Website rebuild'` in any note gives you that project's
  meetings.
- For recurring 1:1s, the 1:1 Notes pack keeps a page per person with the
  running agenda and per-meeting entries; use this pack for everything with
  more than two people in the room.
- The `cortex-view` block in the row template is ordinary Markdown; drop the
  same block into a project note with `filter: project == '...'` to see that
  project's open action items there.
- A table on Meetings with `filter: open_items > 0 and date < @today-14` is
  the list of meetings whose items have been open for more than two weeks.

## Upgrading

From 2.0: the status options are reordered so `followed-up` is last
(`cancelled` moves before it); the meetings schema gains `repeat`,
`open_items` and `progress`; action items gain `completed` and `days_left`.
Existing rows need no change. The new views (This week, To write up, Overdue)
arrive with the update.

From 1.x: version 1 was a single note template, `templates/meeting.md`.
Version 2 is a database. An update leaves the old template in
`templates/meeting.md` (and a later `cortex packs remove` will not delete it
either — remove it yourself if you no longer want it), and your existing
meeting notes stay where they are; move any you want in the database into
`collections/meetings/` and add a `date:` line to the frontmatter.
