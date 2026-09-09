# Content Calendar

Every piece of content as a row, the row as the draft, and campaigns as a
second collection that groups them and counts them back.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/content.yaml` | `.cortex/schemas/content.yaml` | status, channel, format, pillar, priority, due, publish, published_on (stamped), days_left (computed), repeat, owner, campaign, link, repurposed_from |
| `schemas/campaigns.yaml` | `.cortex/schemas/campaigns.yaml` | status, start, end, goal, and three computed from the pieces: pieces, shipped, progress |
| `index.md` | `collections/content/_index.md` | views: Pipeline (board), Calendar, This week, Overdue, Queue, Ideas, Published per month (chart) |
| `index/campaigns.md` | `collections/campaigns/_index.md` | views: Board, Table, Timeline |
| `templates/content.md` | `collections/content/_template-content.md` | New row's shape for a piece: brief, outline, draft, publish checklists, a live table of what was made from it |
| `templates/campaigns.md` | `collections/campaigns/_template-campaigns.md` | New row's shape for a campaign: a live board and a timeline of its pieces, retro |
| `seed/content/*.md` | `collections/content/` | six pieces spread over the last five weeks and the next: an article a day overdue, a newsletter scheduled from it, a post already out, a weekly thread that repeats, a newsletter from last month, a video idea |
| `seed/campaigns/launch-week.md` | `collections/campaigns/` | one campaign running from three days ago to four days ahead, with three of the pieces in it |

Campaigns nest under Content in the sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install content-calendar`).
2. **Open Content Calendar → Ideas** and press New row for every idea you are
   carrying around. A title is enough; everything else can wait.
3. **Commit to one.** Set `channel`, `format` and a `publish` date, drag it to
   *drafting* on the Pipeline board, and write in the page. When it is out,
   paste the `link` and set *published*.

Then delete or rewrite the six seeded pieces and the seeded campaign.

## How it works

Each view answers one question:

| View | Question |
|---|---|
| Pipeline | Where is everything? A column per `status`; drag a card to move it. |
| Calendar | What goes out when? Pieces sit on their `publish` date; ideas without a date stay off it. |
| This week | What goes out this week? Everything with a `publish` date between this Monday and Sunday, with `days_left`. |
| Overdue | What did I let slip? Pieces whose `due` is before today and that are not yet scheduled or published, oldest first. |
| Queue | What do I work on next? Everything in flight, in publish order, with its `due` date and `days_left`. |
| Ideas | What is in the inbox? Only `status: idea`, high priority first, then newest. |
| Published per month | Am I keeping the pace? A bar per month, split by `channel`, counting `published` pieces. |

The properties, and why each is there:

- `status` — idea → drafting → review → scheduled → published. The board and
  the Queue and the chart all key off it.
- `channel` (where: blog, newsletter, youtube, podcast, linkedin, instagram,
  x, tiktok) and `format` (what: article, email, video, short, episode, post,
  thread, carousel) are separate on purpose — a video and the short cut from
  it share a channel but not a format. Edit the option lists to match yours.
- `pillar` — the two or three themes you keep returning to. A multi-select,
  so a piece can be *teach* and *story* at once.
- `priority` — low, medium, high, in that order; views that sort on it sort
  by that order, not alphabetically.
- `due` is the draft deadline; `publish` is the day it goes out. Editorial
  calendars keep both because they are rarely the same day. `days_left` is
  the days from today to `publish`, worked out on read and never written to
  the file, so it is right every morning without touching a row.
- `published_on` is stamped with the day you set `status` to published, once,
  and left alone after that — `publish` is the plan, this is what happened.
- `repeat` — weekly, biweekly or monthly. A piece that carries it comes back:
  the moment it is marked published, the next one is written as a new row
  with `due` and `publish` moved on by the interval and `status` reset to
  idea, and the published row stays as the record. The new row keeps the
  rest of the frontmatter, so clear its `link` before you fill it in again.
  This happens whether the status is changed in the app, with `cortex set`
  or by an agent over MCP.
- `owner` is who is writing it, useful the moment there are two of you.
- `campaign` links a piece to a row in `collections/campaigns/`.
- `link` is the published URL — the archive builds itself.
- `repurposed_from` points at the piece this one was cut from. The parent's
  page lists its children under "Made from this".

A campaign has a `start` and an `end`, and three properties that are computed
from the pieces pointing at it rather than typed: `pieces` (the rows whose
`campaign` names it), `shipped` (how many of those are published) and
`progress` (the share, drawn as a bar). The Table shows them and the Timeline
lays each campaign's window across the weeks with today marked. A campaign's
page shows its pieces as a board and as a schedule — a timeline from each
piece's `due` to its `publish` — both filtered live by the `campaign`
property, and ends with a retro.

## Ideas

- Add the numbers you check a week after publishing (opens, views, replies)
  to the Notes section of the row, so the archive keeps them.
- If you write for search, add a `keyword` text property to the schema and a
  column for it on the Queue.
- Keep a filter on the Queue for one channel (`channel == 'newsletter'`) and
  save it as a second view if you plan one channel at a time.
- Publishing every weekday? Add a view with `filter: "publish == @today"` and
  it is the day's list without any editing.
- Set `cover:` on rows that have a thumbnail and add a gallery view to
  `_index.md` for a picture wall of what is coming.
- Pair it with the **tasks** pack for the small jobs around a piece
  (thumbnail, pull quotes), or the **project-tracker** pack when a campaign
  is really a project with a budget.
- The Ideas view is a fine capture inbox from the terminal:
  `cortex set collections/content/why-i-stopped-batching status=idea` creates
  the row from the template if it does not exist yet.

## Upgrading

From 2.0: nothing to redo. `published_on`, `days_left` and `repeat` are added
to the content schema and `pieces`, `shipped` and `progress` to campaigns;
existing rows pick them up as they are (a row already published has no
`published_on` until you set it). The Campaigns calendar became a timeline,
and the campaign row template's schedule table became a timeline too; rows
created from the old template keep their table.

From 1.x: version 1 had `status`, `channel`, `publish` and `link`. Those
names are kept, so existing rows still work; the update adds the other
properties to the schema and leaves your rows alone. Two channel options were
renamed — `video` is now `youtube` and `social` split into the platform names
— so rows carrying the old values need a new pick from the list.
