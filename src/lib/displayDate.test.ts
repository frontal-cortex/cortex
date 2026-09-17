import test from "node:test";
import assert from "node:assert/strict";
import { friendlyDate, friendlyDateValue } from "./displayDate.ts";

test("a stored date reads as a day, a month and a year", () => {
  assert.equal(friendlyDate("2026-09-16"), "16 Sep 2026");
  assert.equal(friendlyDate("2026-01-05"), "5 Jan 2026");
  assert.equal(friendlyDate("2026-09-16T08:30:00"), "16 Sep 2026, 08:30");
  assert.equal(friendlyDate("next week"), "next week");
  assert.equal(friendlyDate("2026-13-01"), "2026-13-01");
});

test("ranges and non-dates", () => {
  assert.equal(friendlyDateValue({ start: "2026-09-14", end: "2026-09-21" }), "14 Sep 2026 → 21 Sep 2026");
  assert.equal(friendlyDateValue({ start: "2026-09-14" }), "14 Sep 2026");
  assert.equal(friendlyDateValue("2026-09-14"), "14 Sep 2026");
  assert.equal(friendlyDateValue("Groceries"), null);
  assert.equal(friendlyDateValue(12), null);
});
