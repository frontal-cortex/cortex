import test from "node:test";
import assert from "node:assert/strict";
import { rowCollection, collectionOfIndex } from "./paths.ts";

test("a row's collection is read off its path, pages and templates aside", () => {
  assert.equal(rowCollection("collections/accounts/sabadell.md"), "accounts");
  assert.equal(rowCollection("collections/budget-bills/rent-2026.md"), "budget-bills");
  assert.equal(rowCollection("collections/accounts/_index.md"), null, "the collection's page is not a row");
  assert.equal(rowCollection("collections/accounts/_template-accounts.md"), null, "nor is a row template");
  assert.equal(rowCollection("notes/ideas/second-brain.md"), null);
  assert.equal(rowCollection("collections/accounts/nested/deep.md"), null);
});

test("a collection page is read off its path", () => {
  assert.equal(collectionOfIndex("collections/accounts/_index.md"), "accounts");
  assert.equal(collectionOfIndex("collections/accounts/sabadell.md"), null);
});
