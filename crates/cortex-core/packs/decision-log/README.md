# Decision Log

One row per decision, written before you act, with a date to come back and
check how it went — and a view that tells you when that date is here.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/decisions.yaml` | `.cortex/schemas/decisions.yaml` | status, decided, review, days_to_review, reviewed, area, impact, reversible, confidence, confidence_band, owner, outcome, supersedes, superseded_by, link |
| `index.md` | `collections/decisions/_index.md` | views: Log, Board (by status), Due for review, Timeline, Outcomes by month (chart), Calibration (chart) |
| `templates/decisions.md` | `collections/decisions/_template-decisions.md` | New row's shape: Context, Options, Decision, Expected outcome, Consequences, Review |
| `seed/*.md` | `collections/decisions/` | four examples: a decision made four months ago and reviewed as worse, the accepted one that replaced it (review due in nine days), a small one reviewed as expected, and a proposal |

The seeds are examples; delete them once you have one of your own.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install decision-log`).
2. **Open Decisions** in the sidebar, press New row, and write the Context,
   the Options and the Decision. Two to four sentences each — the first time
   someone writes two thousand words of context, the habit dies.
3. **Set `review`** to a date a month or a quarter out, and `status` to
   `accepted` once it is made. `decided` fills in with today. When the
   review date is within a month it appears in Due for review, soonest
   first, and the Timeline shows the bar running towards it.

## How it works

The properties are the things you want to filter on later; the page is the
record.

| Property | What it is for |
|---|---|
| `status` | proposed → accepted, or rejected; later deprecated or superseded. The Board shows the flow. |
| `decided` | stamped with today the first time `status` becomes `accepted` or `rejected`. Stays empty while a row is only proposed; stays editable. |
| `review` | when to look again. You set it; `days_to_review` counts down to it and goes negative once you are late. |
| `reviewed` | stamped with today when you set an `outcome`. |
| `area` | engineering, product, team, money, personal, other — so a team log and a personal one can share a schema. |
| `impact`, `reversible` | how much rides on it, and whether it is a one-way door. High and irreversible deserve the longest Options section. |
| `confidence` | 0–100, your estimate at the time, shown as a percentage. `confidence_band` rounds it to the nearest ten for the Calibration chart. |
| `owner` | who decided. Filter with `owner == @me` for your own. |
| `outcome` | pending until the review date, then as_expected, better, worse or unclear. |
| `supersedes` | the title of the decision this one replaces. |
| `superseded_by` | read-only: whichever rows name this one in their `supersedes`. |
| `link` | the pull request, document or thread where it happened. |

`decided`, `reviewed`, `days_to_review`, `confidence_band` and
`superseded_by` are never typed. The two dates are written into the file the
moment their condition first holds; the other three are worked out every
time a view is drawn and never written anywhere.

The row template follows the architecture-decision-record shape (context,
options with good and bad points, decision, consequences) and adds the
decision-journal parts that make a later review useful: your state of mind,
the expected outcome with a confidence number, and what would prove you
wrong. The Review section is empty on purpose; you fill it on the `review`
date and set `outcome` at the same time.

The views each answer one question:

- **Log** — what have we decided? Every row, newest first, with
  `superseded_by` so a replaced decision shows its successor in the list.
- **Board** — where is each one in its life? Grouped by `status`.
- **Due for review** — what do I owe a look? Accepted decisions with no
  outcome whose `review` date is within the next thirty days or already
  past; the filter is `review <= @today+30`, so it moves with the calendar
  and needs no upkeep.
- **Timeline** — what is in flight? One bar per decision from `decided` to
  `review`, with today marked. Proposals with no `decided` date sit under
  "Unscheduled".
- **Outcomes by month** — are my expectations holding? Decisions counted by
  the month they were made, one colour per outcome.
- **Calibration** — do my 80%s land more often than my 50%s? Reviewed
  decisions grouped by `confidence_band`, one colour per outcome. The seeds
  give it two bars; it means something once you have twenty or so.

Superseding is a relation, not a deletion. When a decision replaces an older
one, set the new row's `supersedes` to the old title and the old row's
`status` to `superseded`. The old row's `superseded_by` fills in on its own,
so the record shows its own replacement without you editing it.

## Ideas

- In force only: a table with `filter: status == 'accepted'`.
- Overdue only: a table with `filter: outcome == 'pending' and review < @today`.
- By area: add a board view with `group: area`.
- Big bets: a table with `filter: impact == 'high' and reversible == false`.
- Reviewed late: a formula property with `expr: days_between(review, reviewed)`
  shows how many days after the review date you actually looked.
- Team use: keep the vault in a git repository; a decision is then a
  reviewable diff, and `link` points at the pull request.
- Meeting notes that end in a decision: write the decision here, and put
  its title in the meeting note.

## Upgrading from 2.0

Nothing to migrate. 2.1 adds `auto` stamps on `decided` and a new `reviewed`
date, the computed `days_to_review`, `confidence_band` and `superseded_by`,
a percent format on `confidence`, a `@today+30` filter on Due for review, a
Timeline view in place of the Review calendar (the same dates, with the
span from `decided` to `review` drawn in), and the Calibration chart. The
"Superseded by" table at the foot of each page is gone from the template
because `superseded_by` shows the same thing; pages made from the 2.0
template keep theirs and it still works. A 2.0 row whose `decided` was
prefilled with the day it was created keeps that date. `cortex packs update`
keeps any file you edited.

## Upgrading from 1.x

Version 1 was a single note template, `templates/decision.md`, with status
and dates in the body. Version 2 is a database. Notes made from the old
template keep working as notes; to bring one into the log, move it to
`collections/decisions/` and add the frontmatter from `templates/decisions.md`
(the section headings are the same).
