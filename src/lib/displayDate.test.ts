import test from "node:test";
import assert from "node:assert/strict";
import { friendlyDate, friendlyDateValue } from "./displayDate.ts";

test("a stored date reads as a day and a month, with the year only when it is another one", () => {
  assert.equal(friendlyDate("2026-09-16", 2026), "16 Sep");
  assert.equal(friendlyDate("2026-01-05", 2026), "5 Jan");
  assert.equal(friendlyDate("2025-12-31", 2026), "31 Dec 2025");
  assert.equal(friendlyDate("2027-03-01", 2026), "1 Mar 2027");
  assert.equal(friendlyDate("2026-09-16T08:30:00", 2026), "16 Sep, 08:30");
  assert.equal(friendlyDate("next week", 2026), "next week");
  assert.equal(friendlyDate("2026-13-01", 2026), "2026-13-01");
});

test("ranges and non-dates", () => {
  const year = new Date().getFullYear();
  assert.equal(friendlyDateValue({ start: `${year}-09-14`, end: `${year}-09-21` }), "14 Sep → 21 Sep");
  assert.equal(friendlyDateValue({ start: `${year}-09-14` }), "14 Sep");
  assert.equal(friendlyDateValue(`${year}-09-14`), "14 Sep");
  assert.equal(friendlyDateValue("Groceries"), null);
  assert.equal(friendlyDateValue(12), null);
});
