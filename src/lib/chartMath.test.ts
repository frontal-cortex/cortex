import test from "node:test";
import assert from "node:assert/strict";
import { niceTicks, compactNumber, fullNumber, xLabel, sortXs, orderSeries, toggleSelection } from "./chartMath.ts";

test("axis ticks land on round numbers past the maximum", () => {
  assert.deepEqual(niceTicks(0, 6900), [0, 2000, 4000, 6000, 8000]);
  assert.deepEqual(niceTicks(0, 7512.1), [0, 2000, 4000, 6000, 8000]);
  assert.deepEqual(niceTicks(0, 38), [0, 10, 20, 30, 40]);
  assert.deepEqual(niceTicks(-50, 100), [-50, 0, 50, 100]);
  assert.deepEqual(niceTicks(0, 0), [0, 0.25, 0.5, 0.75, 1]);
});

test("values on bars are short, values in tooltips are full", () => {
  assert.equal(compactNumber(950), "950");
  assert.equal(compactNumber(1549.09), "1.5k");
  assert.equal(compactNumber(6900), "6.9k");
  assert.equal(compactNumber(12345), "12k");
  assert.equal(compactNumber(3400000), "3.4M");
  assert.equal(compactNumber(12.5), "12.5");
  assert.equal(compactNumber(2000), "2k");
  assert.equal(fullNumber(1549.09), "1,549.09");
});

test("bucketed x values read as months and days", () => {
  assert.equal(xLabel("2026-07"), "Jul 2026");
  assert.equal(xLabel("2026-09-14"), "14 Sep");
  assert.equal(xLabel("Groceries"), "Groceries");
  assert.deepEqual(sortXs(["2026-09", "2026-07", "2026-08", "2026-07"]), ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(sortXs(["10", "9", "100"]), ["9", "10", "100"]);
});

test("the biggest series stacks first", () => {
  const s = orderSeries([
    { name: "Dining", points: [{ x: "a", y: 10 }] },
    { name: "Housing", points: [{ x: "a", y: 1150 }, { x: "b", y: 1150 }] },
    { name: "Bank fees", points: [{ x: "a", y: 10 }] },
  ]);
  assert.deepEqual(s.map((x) => x.name), ["Housing", "Bank fees", "Dining"]);
});

test("clicking isolates a series, clicking again shows all, a modifier adds", () => {
  assert.deepEqual(toggleSelection([], "Food", false), ["Food"]);
  assert.deepEqual(toggleSelection(["Food"], "Food", false), []);
  assert.deepEqual(toggleSelection(["Food"], "Rent", false), ["Rent"]);
  assert.deepEqual(toggleSelection(["Food"], "Rent", true), ["Food", "Rent"]);
  assert.deepEqual(toggleSelection(["Food", "Rent"], "Food", true), ["Rent"]);
});
