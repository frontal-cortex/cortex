---
created: "{{today}}"
icon: 👥
tags: []
title: Contacts
type: database
views:
- name: Reach out
  type: table
  columns: [title, cadence, last_seen, quiet_days, due_in, relationship]
  filter: due_in <= 0 or quiet_days == '' and archived != true and cadence != 'as needed'
  sort: [due_in]
- name: Follow-ups due
  type: table
  columns: [title, follow_up, cadence, last_seen, relationship]
  filter: follow_up <= @today and archived != true
  sort: [follow_up]
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
  columns: [title, relationship, cadence, last_seen, quiet_days, company, role, email, phone, location, website, birthday]
  sort: [title]
---

One row per person you want to stay in touch with. `cadence` is how often you
mean to talk: monthly for the handful who matter most, quarterly for the wider
circle, twice a year or yearly for people you would rather not lose, `as
needed` for everyone else.

Three columns are worked out for you. `last_seen` is the date of the newest
row in Interactions that names this person. `quiet_days` is how long it has
been — counted from `last_seen`, or from `last_contact` if you typed a date
from memory and have not logged anything since; whichever is more recent
wins. `due_in` is the days left before the cadence runs out: monthly is 30,
quarterly 91, twice a year 182, yearly 365. Negative means overdue.

Reach out is the list of people whose `due_in` has reached zero, most overdue
first, plus anyone with a cadence and no contact on record at all — a new
person stays there until you talk. `as needed` people never appear in it.
After a conversation, add a row to Interactions with the date and who it was;
nothing on the person needs touching, and they drop off the list on their
own. Their page lists every interaction you have logged with them, so the
history is there before the next call.

Set `follow_up` when you promise to call back. Follow-ups due lists the
promises whose date has come; the Follow-ups calendar shows the ones ahead.
Clear the date when you have done it.

Tick `archived` for someone you no longer keep up with instead of deleting
them: they leave the boards and both lists, and Everyone still has the number.
