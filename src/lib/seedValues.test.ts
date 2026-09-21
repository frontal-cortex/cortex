import test from "node:test";
import assert from "node:assert/strict";
import { resolveSeedValue, resolveAtWord } from "./seedValues.ts";

const thu = new Date(2026, 8, 17); // Thursday 17 September 2026

test("a row added to a filtered view carries what the filter means", () => {
  assert.equal(resolveSeedValue("@this", "Leg day", thu), "Leg day", "the page the view sits on");
  assert.equal(resolveSeedValue("@today", "", thu), "2026-09-17");
  assert.equal(resolveSeedValue("@today-1", "", thu), "2026-09-16");
  assert.equal(resolveSeedValue("working", "", thu), "working", "a plain value is itself");
  assert.equal(resolveSeedValue("@nonsense", "", thu), "@nonsense", "an unknown word is left alone");
});

test("the date words a filter may use", () => {
  assert.equal(resolveAtWord("@monday", thu), "2026-09-14");
  assert.equal(resolveAtWord("@monday-1", thu), "2026-09-07");
  assert.equal(resolveAtWord("@sunday", thu), "2026-09-20");
  assert.equal(resolveAtWord("@tomorrow", thu), "2026-09-18");
  assert.equal(resolveAtWord("@yesterday", thu), "2026-09-16");
  assert.equal(resolveAtWord("@month", thu), "2026-09");
  assert.equal(resolveAtWord("@month-1", thu), "2026-08");
  assert.equal(resolveAtWord("@year", thu), "2026");
  assert.equal(resolveAtWord("Groceries", thu), null);
});
