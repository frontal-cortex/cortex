# Contacts

A personal CRM: people with a keep-in-touch cadence, and one file per
conversation. Who is overdue is worked out from the log, not typed in.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/contacts.yaml` | `.cortex/schemas/contacts.yaml` | relationship, cadence, company, role, email, phone, location, website, birthday, last_contact, follow_up, archived; computed: last_seen, quiet_days, due_in |
| `schemas/interactions.yaml` | `.cortex/schemas/interactions.yaml` | date, people (relation to contacts), kind, summary |
| `index.md` | `collections/contacts/_index.md` | views: Reach out, Follow-ups due, Follow-ups (calendar), By relationship, By cadence, Everyone |
| `index/interactions.md` | `collections/interactions/_index.md` | views: Recent, Calendar, Per month (chart by kind) |
| `templates/contacts.md` | `collections/contacts/_template-contacts.md` | New row for a person: About, Remember, Next time, and their own interactions embedded |
| `templates/interactions.md` | `collections/interactions/_template-interactions.md` | New row for a conversation: date, people, kind, summary; notes and next steps |
| `seed/contacts/*.md` | `collections/contacts/` | three obviously-fictional people: a friend (monthly, overdue), a colleague (quarterly, fine), a mentor (twice a year, never logged) |
| `seed/interactions/*.md` | `collections/interactions/` | a coffee forty days ago and a call three weeks ago, so the pages, the lists and the chart have something to show |

Interactions nests under Contacts in the sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install contacts`).
2. **Add five people** with New row in Contacts — the ones you would be sorry
   to lose touch with. Set `cadence` honestly: monthly is for a handful. If
   you remember roughly when you last spoke, type it in `last_contact`; if
   not, leave it blank and the person sits in Reach out until you talk.
3. **Log the next conversation** you have: New row in Interactions, pick the
   person in `people`, write one line in `summary`. That is all: their
   `last_seen` becomes that date, `due_in` resets, and they leave Reach out.
   Open their page: the conversation is listed under Interactions.

## How it works

- **Three computed columns.** `last_seen` is the newest `date` among the
  Interactions rows that name the person (a rollup over the relation, so a
  row with three people updates all three). `quiet_days` counts from that
  date, or from `last_contact` when it is more recent or the only date there
  is. `due_in` is the cadence in days — 30, 91, 182, 365 — minus
  `quiet_days`; negative means overdue. None of the three is written to the
  file; they are read from the log each time.
- **Reach out** is the daily view: everyone with `due_in` at or below zero,
  most overdue first, plus anyone with a cadence and no date at all. `as
  needed` people and archived people never appear. It empties itself as you
  log conversations.
- **Follow-ups due** lists the `follow_up` dates that have arrived — the
  promises ("call back after the interview") you now owe. **Follow-ups** is
  the same dates on a calendar, for what is coming. Clear the date when done.
- **By relationship** answers "who do I know at work / in the family"; **By
  cadence** shows whether your monthly column has grown past what you can
  keep up with. Drag a card to change either.
- **Everyone** is the address book, sorted by name, archived people
  included, with `last_seen` and `quiet_days` beside the phone number.
- **Interactions** is one row per conversation, not per person. Because
  `people` is a relation, one row can name several people and appears on
  each of their pages. The month chart counts rows by `date` with one bar
  per `kind`, so it shows how much you are actually in touch, and how —
  messages or meals.
- **`last_contact` is the fallback.** It is for the date you remember from
  before you started logging, or for a conversation you did not bother to
  log. Once there is a newer Interactions row, `last_seen` takes over.
- **Archive, do not delete.** Tick `archived` and the person leaves the
  boards and both lists but keeps their history.

## Ideas

- Log from a meeting note: create the Interactions row and paste the link
  to the meeting note in its body, or the other way round.
- A short list for a Sunday evening: add `and cadence == 'monthly'` to the
  end of the Reach out filter and save it as another view.
- Who is due in the next two weeks, before they are overdue:
  `filter: due_in > 0 and due_in <= 14 and archived != true`.
- Family and close friends: set `cadence: monthly` and put the next birthday
  in `follow_up`; it shows in Follow-ups due on the day.
- Over MCP or from a terminal, an agent that has just summarised a call can
  log it with one `create_note` in `collections/interactions` — the person's
  row needs nothing.
- The `meeting-notes` and `one-on-one` packs are the note-side of the same
  people: link the person's page with `[[Alex Example]]` and their
  back-links show every meeting.

## Upgrading from 2.0

No property is renamed or removed. Updating merges `last_seen`, `quiet_days`
and `due_in` into the schema and replaces the index views. A `last_contact`
you typed keeps counting until an Interactions row for that person is newer,
so nobody falls off Reach out just because you upgraded. You no longer need
to set `last_contact` after logging a conversation; you can, and the newer
of the two dates wins either way.

## Upgrading from 1.x

Version 1 had one collection with `relationship`, `company`, `role`,
`email`, `last_contact` and `follow_up`. Version 2 keeps every one of those
names, so existing rows are untouched; updating merges the new properties
(`cadence`, `phone`, `location`, `website`, `birthday`, `archived`)
into the schema and adds the Interactions collection. Rows made from the old
template keep their `## Log` section; new rows get the embedded Interactions
table instead. Set `cadence` on your existing people and they sort into the
By cadence board.
