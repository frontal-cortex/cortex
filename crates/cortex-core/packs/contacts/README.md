# Contacts

A personal CRM: people with a keep-in-touch cadence, and one file per
conversation.

## What it installs

| File | Lands at | What it is |
|---|---|---|
| `schemas/contacts.yaml` | `.cortex/schemas/contacts.yaml` | relationship, cadence, company, role, email, phone, location, website, birthday, last_contact, follow_up, archived |
| `schemas/interactions.yaml` | `.cortex/schemas/interactions.yaml` | date, people (relation to contacts), kind, summary |
| `index.md` | `collections/contacts/_index.md` | views: Reach out, Follow-ups (calendar), By relationship, By cadence, Everyone |
| `index/interactions.md` | `collections/interactions/_index.md` | views: Recent, Calendar, Per month (chart) |
| `templates/contacts.md` | `collections/contacts/_template-contacts.md` | New row for a person: About, Remember, Next time, and their own interactions embedded |
| `templates/interactions.md` | `collections/interactions/_template-interactions.md` | New row for a conversation: date, people, kind, summary; notes and next steps |
| `seed/contacts/*.md` | `collections/contacts/` | three obviously-fictional people: a friend (monthly), a colleague (quarterly), a mentor (twice a year) |
| `seed/interactions/*.md` | `collections/interactions/` | a coffee and a call, so the pages and the chart have something to show |

Interactions nests under Contacts in the sidebar.

## How to start

1. **Install** the pack (Marketplace, or `cortex packs install contacts`).
2. **Add five people** with New row in Contacts — the ones you would be sorry
   to lose touch with. Set `cadence` honestly: monthly is for a handful.
   Fill `last_contact` from memory; the template leaves it blank, and a blank
   one sorts to the top of Reach out, which is the point.
3. **Log the next conversation** you have: New row in Interactions, pick the
   person in `people`, write one line in `summary`, then set the person's
   `last_contact` to that date. Open their page: the conversation is listed
   under Interactions.

## How it works

- **Reach out** is the daily view. It hides archived people and sorts by
  `last_contact`, oldest first, with `cadence` beside it: a monthly person
  last spoken to in spring is overdue, a yearly one is not. No formula
  decides for you; the two columns side by side are enough.
- **Follow-ups** is a calendar of `follow_up`. Use it for promises ("call
  back after the interview") and nudges, and clear it when done.
- **By relationship** answers "who do I know at work / in the family"; **By
  cadence** shows whether your monthly column has grown past what you can
  keep up with. Drag a card to change either.
- **Everyone** is the address book: company, role, email, phone, location,
  website, birthday, sorted by name, archived people included.
- **Interactions** is one row per conversation, not per person. Because
  `people` is a relation, one row can name several people and appears on
  each of their pages. The month chart counts rows by `date`, so it shows
  how much you are actually in touch, not how much you meant to be.
- **Archive, do not delete.** Tick `archived` and the person leaves the
  boards and the Reach out list but keeps their history.

## Ideas

- Log from a meeting note: create the Interactions row and paste the link
  to the meeting note in its body, or the other way round.
- Family and close friends: set `cadence: monthly` and a `follow_up` on the
  next birthday, then move it forward a year each time it comes round.
- A filter on the Reach out view such as `cadence == 'monthly'` gives a
  short list for a Sunday evening; save it as another view.
- Over MCP or from a terminal, `cortex set collections/contacts/alex-example last_contact=2026-09-08`
  updates the date after you have logged the call.
- The `meeting-notes` and `one-on-one` packs are the note-side of the same
  people: link the person's page with `[[Alex Example]]` and their
  back-links show every meeting.

## Upgrading from 1.x

Version 1 had one collection with `relationship`, `company`, `role`,
`email`, `last_contact` and `follow_up`. Version 2 keeps every one of those
names, so existing rows are untouched; updating merges the new properties
(`cadence`, `phone`, `location`, `website`, `birthday`, `archived`)
into the schema and adds the Interactions collection. Rows made from the old
template keep their `## Log` section; new rows get the embedded Interactions
table instead. Set `cadence` on your existing people and they sort into the
By cadence board.
