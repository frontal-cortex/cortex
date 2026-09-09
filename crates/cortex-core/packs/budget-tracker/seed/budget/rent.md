---
title: "Rent (example)"
type: note
tags: []
date: "{{today-2}}"
amount: 1150
kind: expense
category: housing
account: checking
payee: "Landlord"
bill: ["Rent"]
created: "{{today}}"
---

An expense linked to a bill: `bill: [Rent]` points at the Rent row in
`budget-bills`, so that bill's `last_paid` is this date, its `total_paid`
includes this amount, and opening it lists this payment under Payments.
Delete it once you have logged your own rent.
