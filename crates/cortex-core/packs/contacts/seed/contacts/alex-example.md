---
title: Alex Example
type: note
tags: []
icon: 🧑
relationship: friend
cadence: monthly
company: "Example Co."
role: "Product designer"
email: "alex@example.com"
phone: "+00 000 000 000"
location: "Lisbon"
website: https://example.com
birthday: 1990-04-12
last_contact:
follow_up: "{{today-2}}"
archived: false
created: "{{today-60}}"
---

An example person so the Contacts views are not empty on first open. Alex is
monthly and the last logged conversation was forty days ago, so `due_in` is
ten days negative and Alex is at the top of Reach out; the promised
introduction is two days late, so Alex is in Follow-ups due as well. Replace
the details with a real friend, or delete the row.

## About

Met at university; we shared a flat in second year. Designer at Example
Co., thinking about going freelance. Runs, badly, and likes to talk about it.

## Remember

Partner is Sam; two cats. Wants book recommendations on typography.

## Next time

- [ ] Ask how the freelance plan is going
- [ ] Send the typography book list

## Interactions

```cortex-view
source: collections/interactions
type: table
columns: [title, date, kind, summary]
filter: people contains 'Alex Example'
sort: [date desc]
```
