---
created: "{{today}}"
icon: 👥
tags: []
title: Contacts
type: database
views:
- name: Reach out
  type: table
  columns: [title, cadence, last_contact, follow_up, relationship]
  filter: archived != true
  sort: [last_contact]
- name: Follow-ups
  type: calendar
  date: follow_up
- name: By relationship
  type: board
  group: relationship
  filter: archived != true
- name: By cadence
  type: board
  group: cadence
  filter: archived != true
- name: Everyone
  type: table
  columns: [title, relationship, company, role, email, phone, location, website, birthday]
  sort: [title]
---

One row per person you want to stay in touch with. `cadence` is how often you
mean to talk: monthly for the handful who matter most, quarterly for the wider
circle, twice a year or yearly for people you would rather not lose, `as
needed` for everyone else. Reach out sorts by `last_contact`, oldest first, so
the top of the list is the person you have gone longest without; read it next
to the cadence column and you know who is overdue. A blank `last_contact`
sorts to the top, so a new person stays there until you fill it in.

After a conversation, add a row to Interactions with the date, who it was and
one line of summary, then set `last_contact` on the person to that date. Their
page lists every interaction you have logged with them, so the history is
there before the next call. Set `follow_up` when you promise to call back and
the Follow-ups calendar shows the week.

Tick `archived` for someone you no longer keep up with instead of deleting
them: they leave the boards and the Reach out list, and Everyone still has the
number.
