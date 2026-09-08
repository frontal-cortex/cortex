# 1:1 Notes

A page per person, a row per meeting, and the follow-ups from all of them in
one list.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/people.yaml` | `.cortex/schemas/people.yaml` | relationship, role, team, cadence, start, focus, archived |
| `schemas/one-on-ones.yaml` | `.cortex/schemas/one-on-ones.yaml` | date, person (relation), kind, status, mood, summary |
| `schemas/follow-ups.yaml` | `.cortex/schemas/follow-ups.yaml` | person and one_on_one (relations), owner, due, status |
| `index.md` | `collections/people/_index.md` | views: People, Reports, By relationship (board), Everyone |
| `index/one-on-ones.md` | `collections/one-on-ones/_index.md` | views: Recent, Planned, Calendar, Mood (chart), Per person (chart) |
| `index/follow-ups.md` | `collections/follow-ups/_index.md` | views: Open, Mine, Theirs, Board, Due (calendar) |
| `templates/people.md` | `collections/people/_template-people.md` | a person's page: about, focus, career, topics for next time, feedback given, live tables of open follow-ups and 1:1s |
| `templates/one-on-ones.md` | `collections/one-on-ones/_template-one-on-ones.md` | a meeting's page: their topics, mine, since last time, wins, blockers, growth, feedback, follow-ups, notes for their page |
| `templates/follow-ups.md` | `collections/follow-ups/_template-follow-ups.md` | a follow-up: context and outcome |
| `seed/people/*.md` | `collections/people/` | two example people: a weekly report and a fortnightly peer |
| `seed/one-on-ones/*.md` | `collections/one-on-ones/` | one held 1:1 and one planned |
| `seed/follow-ups/*.md` | `collections/follow-ups/` | one open follow-up each way and one already done, each linked to a person and a meeting |

1:1s and Follow-ups nest under People in the sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install one-on-one`).
2. **Add the people.** Open People, New row, name them, set `relationship` and
   `cadence`. Fill in what you know under About and Current focus; leave the
   rest.
3. **Before each meeting**, open 1:1s and press New row. Set `person`, paste
   in the topics from their page, and write as you go. Afterwards, set
   `status` to `held`, pick a `mood`, write the one-line `summary`, and give
   each promise a row in Follow-ups with `owner` `me` or `them`.

Delete the two example people, their 1:1s and follow-ups when you no longer
need the shape in front of you.

## How it works

- **The person page is the record that lasts.** Meetings come and go; what
  they are working towards, what they want next, and what you have told them
  live on their page. The template ends with two live blocks: their open
  follow-ups, and every 1:1 with them newest first — so the last time you met
  is the first row. "Topics for next time" is the running agenda — the
  single-note 1:1 pattern from version 1, kept.
- **A 1:1 is a row and a page.** The row has what you scan a quarter later —
  date, mood, summary — and the page has the conversation. `skipped` is a
  status, not a deletion, so a missed month is visible in Recent and on the
  Calendar.
- **Follow-ups are shared.** One list for what either of you promised, related
  to both the person and the meeting. Open sorts by due date across everyone;
  Mine is your list to clear before the next round; Theirs is what to ask
  about. A 1:1's page shows the follow-ups it produced; a person's page shows
  everything still open with them.
- **Two charts.** Mood counts held 1:1s per week by mood — a run of `low` is
  the earliest signal you get. Per person counts them per month, which shows
  who is getting your time and who is not, and is the cadence check. Planned
  and skipped meetings are left out of both.
- **Archiving.** Tick `archived` when someone leaves your orbit. They drop out
  of People and Reports, stay in Everyone, and their history stays linked.

## Ideas

- A `level` or `track` select on People turns the Reports table into a quick
  org view; a `last_review` date and a Calendar view on it keeps review
  season in sight.
- The two `cortex-view` blocks on the person page are plain Markdown: paste
  the follow-ups block into your weekly review with `filter: owner == 'me'
  and status == 'open'` and it becomes your Monday list.
- Add a table view to 1:1s with `filter: mood == 'low'` and `sort: [date
  desc]` if you want the warning signs on their own page.
- For meetings with more than two people, the Meeting Notes pack keeps a
  meetings database with its own action items; the two packs sit side by side.

## Upgrading from 1.x

Version 1 was one note template, `templates/one-on-one.md`, with a dated
block per meeting. Version 2 is three databases. An update leaves the old
template in place and stops tracking it, so delete `templates/one-on-one.md`
yourself once you no longer need it. To bring an old running note across, create the person
with New row in People, paste the top of the old note under About and Topics
for next time, and leave the dated blocks where they are — or split each into
a row in 1:1s with its `date` and `person` set.
