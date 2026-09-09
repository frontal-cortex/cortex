# 1:1 Notes

A page per person, a row per meeting, and the follow-ups from all of them in
one list.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/people.yaml` | `.cortex/schemas/people.yaml` | relationship, role, team, cadence, start, focus, archived; computed `last_met`, `next_planned`, `held_90d`, `open_follow_ups`, `days_since_met`, `due` |
| `schemas/one-on-ones.yaml` | `.cortex/schemas/one-on-ones.yaml` | date, person (relation), kind, status, mood, summary, repeat; computed `open_follow_ups` |
| `schemas/follow-ups.yaml` | `.cortex/schemas/follow-ups.yaml` | person and one_on_one (relations), owner, due, status, `completed` (stamped), computed `days_left` |
| `index.md` | `collections/people/_index.md` | views: People, Due, Weekly (tracker), Reports, By relationship (board), Everyone |
| `index/one-on-ones.md` | `collections/one-on-ones/_index.md` | views: Recent, This week, Planned, Calendar, Mood (chart), Per person (chart) |
| `index/follow-ups.md` | `collections/follow-ups/_index.md` | views: Open, Overdue, Mine, Theirs, Board, Due (calendar) |
| `templates/people.md` | `collections/people/_template-people.md` | a person's page: about, focus, career, topics for next time, feedback given, live tables of open follow-ups and 1:1s |
| `templates/one-on-ones.md` | `collections/one-on-ones/_template-one-on-ones.md` | a meeting's page: their topics, mine, since last time, wins, blockers, growth, feedback, follow-ups, notes for their page |
| `templates/follow-ups.md` | `collections/follow-ups/_template-follow-ups.md` | a follow-up: context and outcome |
| `seed/people/*.md` | `collections/people/` | two example people: a weekly report and a fortnightly peer |
| `seed/one-on-ones/*.md` | `collections/one-on-ones/` | three held 1:1s over the last two weeks (one repeating weekly) and one planned for tomorrow |
| `seed/follow-ups/*.md` | `collections/follow-ups/` | one done, one overdue on their side, one due today and one due in two days on yours, each linked to a person and a meeting |

1:1s and Follow-ups nest under People in the sidebar. The seeds are dated
relative to the day you install, so Due, the tracker, the calendar and both
charts show a shape from the first open.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install one-on-one`).
2. **Add the people.** Open People, New row, name them, set `relationship` and
   `cadence`. Fill in what you know under About and Current focus; leave the
   rest. Everyone you add is due until you have met them once.
3. **Before each meeting**, open 1:1s and press New row. Set `person`, paste
   in the topics from their page, and write as you go. Afterwards, set
   `status` to `held`, pick a `mood`, write the one-line `summary`, and give
   each promise a row in Follow-ups with `owner` `me` or `them`. For a
   standing 1:1, set `repeat` once and the next row makes itself.

Delete the two example people, their 1:1s and follow-ups when you no longer
need the shape in front of you.

## How it works

- **The person page is the record that lasts.** Meetings come and go; what
  they are working towards, what they want next, and what you have told them
  live on their page. The template ends with two live blocks: their open
  follow-ups, and every 1:1 with them newest first — so the last time you met
  is the first row. "Topics for next time" is the running agenda — the
  single-note 1:1 pattern from version 1, kept.
- **The numbers on a person are computed, not typed.** `last_met` is the max
  `date` of their held 1:1s; `next_planned` the min date of a planned one from
  today on; `held_90d` a count of held 1:1s in the last ninety days;
  `open_follow_ups` a count of open promises naming them. `days_since_met` is
  a formula on `last_met`, and `due` is true when that gap has reached the
  person's cadence — 7 days for `weekly`, 14 for `biweekly`, 30 for
  `monthly` — or when you have never met; `ad-hoc` people are never due. All
  of it is worked out from the files on read, so it cannot drift.
- **Due is the list to book from.** People whose cadence has lapsed, longest
  wait first, with `next_planned` beside them so you can see who is already
  in the diary. Weekly is a tracker: the weekly-cadence people as rows, the
  days of the month as columns, a tick on each day a 1:1 with them exists in
  the 1:1s list. A gap in the grid is a week you did not meet.
- **A 1:1 is a row and a page.** The row has what you scan a quarter later —
  date, mood, summary, open follow-ups — and the page has the conversation.
  `skipped` is a status, not a deletion, so a missed month is visible in
  Recent and on the Calendar. Planned is soonest first, so a planned 1:1
  whose date has passed rises to the top: the nudge to mark it held or
  skipped. This week is Monday to Sunday.
- **Standing 1:1s repeat.** Set `repeat` to `weekly`, `biweekly` or
  `monthly`, and when the 1:1 is marked `held` the next occurrence is written
  as a new row: same title and page, `date` moved on by the interval,
  `status` back to `planned`. The old row stays as history. `held` is the
  last status option on purpose — that is what tells the engine the row is
  finished; a `skipped` 1:1 does not spawn the next one, so add that one
  yourself. Because the title carries over, the follow-ups block on the page
  shows every occurrence's follow-ups; rename an occurrence if you want them
  apart.
- **Follow-ups are shared.** One list for what either of you promised, related
  to both the person and the meeting. Open sorts by due date across everyone,
  with `days_left` counting down and going negative; Overdue is the open ones
  past their date; Mine is your list to clear before the next round; Theirs
  is what to ask about. When one reaches `done`, `completed` is stamped with
  the day. A 1:1's page shows the follow-ups it produced; a person's page
  shows everything still open with them.
- **Two charts.** Mood counts held 1:1s per week by mood — a run of `low` is
  the earliest signal you get. Per person counts them per month, which shows
  who is getting your time and who is not; `held_90d` on Reports is the same
  check as one number. Planned and skipped meetings are left out of both.
- **Archiving.** Tick `archived` when someone leaves your orbit. They drop out
  of People, Due, Weekly and Reports, stay in Everyone, and their history
  stays linked.

## Ideas

- A `level` or `track` select on People turns the Reports table into a quick
  org view; a `last_review` date and a Calendar view on it keeps review
  season in sight.
- The two `cortex-view` blocks on the person page are plain Markdown: paste
  the follow-ups block into your weekly review with `filter: owner == 'me'
  and status == 'open'` and it becomes your Monday list; the Due table
  (`source: collections/people`, `filter: due == true`) beside it is who to
  book.
- Add a table view to 1:1s with `filter: mood == 'low' and date >= @today-60`
  if you want the recent warning signs on their own page.
- For meetings with more than two people, the Meeting Notes pack keeps a
  meetings database with its own action items; the two packs sit side by side.

## Upgrading

From 2.0: the 1:1 status options are reordered so `held` is last (`skipped`
moves before it); People gains the six computed properties, 1:1s gain
`repeat` and `open_follow_ups`, Follow-ups gain `completed` and `days_left`.
Existing rows need no change; the new views (Due, Weekly, This week, Overdue)
arrive with the update.

From 1.x: version 1 was one note template, `templates/one-on-one.md`, with a
dated block per meeting. Version 2 is three databases. An update leaves the
old template in place and stops tracking it, so delete
`templates/one-on-one.md` yourself once you no longer need it. To bring an
old running note across, create the person with New row in People, paste the
top of the old note under About and Topics for next time, and leave the dated
blocks where they are — or split each into a row in 1:1s with its `date` and
`person` set.
