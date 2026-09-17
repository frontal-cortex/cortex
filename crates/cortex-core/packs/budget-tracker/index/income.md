---
created: "{{today}}"
icon: 📥
tags: []
title: Income
type: database
views:
- name: Recent
  type: table
  columns: [title, amount, source, account, date]
  sort: [date desc]
  limit: 25
- name: Monthly
  type: list
  columns: [title, source, amount, account]
  sort: [date desc]
  group: date
  bucket: month
  summary: {amount: sum}
- name: Yearly
  type: list
  columns: [title, source, amount, account]
  sort: [date desc]
  group: date
  bucket: year
  summary: {amount: sum}
- name: Chart
  type: chart
  chartType: bar
  x: date
  bucket: month
  y: amount
  agg: sum
  series: source
  stack: true
  filter: date >= @month-11
---

Money coming in, one row per payment: salary, a freelance invoice, a refund,
interest. Set the amount, where it came from and the account it arrived in;
the account's balance counts it straight away.

Recent is the latest. Monthly and Yearly fold it into one section per month or
year with a total. Chart stacks the last twelve months by source, which is the
picture to look at when one source quietly shrinks.
