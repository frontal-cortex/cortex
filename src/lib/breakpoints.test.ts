// Run with `npm run test:lib` (node's built-in runner; no bundler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BREAKPOINTS, viewportSize, viewportQuery, breakpointProperties } from "./breakpoints.ts";

test("widths map to the three sizes with exclusive upper bounds", () => {
  assert.equal(viewportSize(0), "phone");
  assert.equal(viewportSize(390), "phone");
  assert.equal(viewportSize(BREAKPOINTS.phone - 1), "phone");
  assert.equal(viewportSize(BREAKPOINTS.phone), "compact");
  assert.equal(viewportSize(BREAKPOINTS.compact - 1), "compact");
  assert.equal(viewportSize(BREAKPOINTS.compact), "wide");
  assert.equal(viewportSize(1280), "wide");
});

test("the media queries partition the width axis without gaps or overlap", () => {
  assert.equal(viewportQuery("phone"), "(max-width: 599px)");
  assert.equal(viewportQuery("compact"), "(min-width: 600px) and (max-width: 819px)");
  assert.equal(viewportQuery("wide"), "(min-width: 820px)");
});

test("custom properties mirror the same numbers", () => {
  assert.deepEqual(breakpointProperties(), { "--bp-phone": "600px", "--bp-compact": "820px" });
  assert.deepEqual(breakpointProperties({ phone: 500, compact: 900 }), { "--bp-phone": "500px", "--bp-compact": "900px" });
  assert.equal(viewportSize(700, { phone: 500, compact: 900 }), "compact");
});
