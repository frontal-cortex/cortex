# Decision Log

One row per decision, written before you act, with a date to come back and
check how it went.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/decisions.yaml` | `.cortex/schemas/decisions.yaml` | status, decided, review, area, impact, reversible, confidence, owner, outcome, supersedes, link |
| `index.md` | `collections/decisions/_index.md` | views: Log, Board (by status), Due for review, Review calendar, Outcomes by month (chart) |
| `templates/decisions.md` | `collections/decisions/_template-decisions.md` | New row's shape: Context, Options, Decision, Expected outcome, Consequences, Review, and a live "Superseded by" table |
| `seed/*.md` | `collections/decisions/` | three examples: a superseded decision, the accepted one that replaced it, and a proposal |

The seeds are examples; delete them once you have one of your own.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install decision-log`).
2. **Open Decisions** in the sidebar, press New row, and write the Context,
   the Options and the Decision. Two to four sentences each — the first time
   someone writes two thousand words of context, the habit dies.
3. **Set `review`** to a date a month or a quarter out, and `status` to
   `accepted` once it is made. It now sits in Due for review, soonest first,
   and on the Review calendar.

## How it works

The properties are the things you want to filter on later; the page is the
record.

| Property | What it is for |
|---|---|
| `status` | proposed → accepted, or rejected; later deprecated or superseded. The Board shows the flow. |
| `decided`, `review` | when it was made, and when to look again. New rows prefill `decided` with today; clear it while a row is only proposed. The calendar is on `review`. |
| `area` | engineering, product, team, money, personal, other — so a team log and a personal one can share a schema. |
| `impact`, `reversible` | how much rides on it, and whether it is a one-way door. High and irreversible deserve the longest Options section. |
| `confidence` | 0–100, your estimate at the time. Over a year this is what tells you whether you are over- or under-confident. |
| `owner` | who decided. Filter with `owner == @me` for your own. |
| `outcome` | pending until the review date, then as_expected, better, worse or unclear. |
| `supersedes` | the title of the decision this one replaces. |
| `link` | the pull request, document or thread where it happened. |

The row template follows the architecture-decision-record shape (context,
options with good and bad points, decision, consequences) and adds the
decision-journal parts that make a later review useful: your state of mind,
the expected outcome with a confidence number, and what would prove you
wrong. The Review section is empty on purpose; you fill it on the `review`
date and set `outcome` at the same time. Outcomes by month counts decisions
by the month they were made, one bar per outcome, so you can see whether
your expectations held more often as the log grew.

Superseding is a relation, not a deletion. When a decision replaces an older
one, set the new row's `supersedes` to the old title and the old row's
`status` to `superseded`. Every decision page ends with a "Superseded by"
table that lists whichever rows point at it, so the old record shows its own
replacement without you editing it.

## Ideas

- In force only: a table with `filter: status == 'accepted'`.
- By area: add a board view with `group: area`.
- Big bets: a table with `filter: impact == 'high' and reversible == false`.
- Calibration: a chart with `x: confidence`, `agg: count`, `series: outcome`
  shows whether your 80%s land more often than your 50%s.
- Team use: keep the vault in a git repository; a decision is then a
  reviewable diff, and `link` points at the pull request.
- Meeting notes that end in a decision: write the decision here, and put
  its title in the meeting note.

## Upgrading from 1.x

Version 1 was a single note template, `templates/decision.md`, with status
and dates in the body. Version 2 is a database. Notes made from the old
template keep working as notes; to bring one into the log, move it to
`collections/decisions/` and add the frontmatter from `templates/decisions.md`
(the section headings are the same). `cortex packs update` keeps any file
you edited.
