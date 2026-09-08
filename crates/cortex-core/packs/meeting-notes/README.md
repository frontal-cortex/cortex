# Meeting Notes

Meetings as rows, action items as rows of their own, linked back to the
meeting they came from.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/meetings.yaml` | `.cortex/schemas/meetings.yaml` | date, kind, status, attendees, project, summary, link |
| `schemas/action-items.yaml` | `.cortex/schemas/action-items.yaml` | meeting (relation), owner, due, status |
| `index.md` | `collections/meetings/_index.md` | views: All, Upcoming, Calendar, Follow-up (board), Per week (chart) |
| `index/action-items.md` | `collections/action-items/_index.md` | views: Open, Mine, Board, Due (calendar), By week (chart) |
| `templates/meetings.md` | `collections/meetings/_template-meetings.md` | New row's shape for a meeting: agenda, notes, decisions, action items with a live table, open questions, next meeting |
| `templates/action-items.md` | `collections/action-items/_template-action-items.md` | New row's shape for an action item: context and outcome |
| `seed/*.md` | `collections/meetings/` | two example meetings, one held and one scheduled |
| `seed/action-items/*.md` | `collections/action-items/` | one open and one done item, each linked to its meeting |

Action items nest under Meetings in the sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install meeting-notes`).
2. **Open Meetings** and press New row. Name it, and the page opens with today's
   date and time filled in and the headings ready. Set `kind`, and add the
   agenda before the meeting if you can.
3. **After the meeting**, write the one-line `summary`, set `status` to
   `held`, and give each action item a row: New row in Action items, pick the
   `meeting`, set `owner` and `due`. When they are all logged, mark the meeting
   `followed-up`.

Delete the two example meetings and their action items when you no longer
need the shape in front of you.

## How it works

- **A meeting is a row and a page.** The row holds what you filter on; the
  page holds what you read later. All sorts by date, newest first, and shows
  the summary, so scanning a month of meetings takes seconds. Upcoming lists
  what is still `scheduled`, with the call link one click away; the Calendar
  answers "when did we talk about that?".
- **Status is a follow-up checklist.** `scheduled` → `held` → `followed-up`.
  The Follow-up board shows every meeting whose action items have not been
  logged and handed out yet. `cancelled` keeps the row so the gap is visible.
- **Action items live in their own list.** Each has one owner, a due date and
  a status, and a `meeting` relation. The meeting's page embeds its own items
  (a `cortex-view` block filtered to that meeting), and the Action items page
  shows everything open across all meetings. Mine filters `owner` to `@me`:
  the vault member matching your git name or email.
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

## Upgrading from 1.x

Version 1 was a single note template, `templates/meeting.md`. Version 2 is a
database. An update leaves the old template in `templates/meeting.md` (and
a later `cortex packs remove` will not delete it either — remove it yourself
if you no longer want it), and your existing meeting notes stay where they
are; move any you want in the database into `collections/meetings/` and add
a `date:` line to the frontmatter.
