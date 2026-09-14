import test from "node:test";
import assert from "node:assert/strict";
import { isCollectionRow, rowNotePath } from "./rows.ts";

test("a row's note sits in its collection's folder", () => {
  assert.equal(rowNotePath("collections/habits", "read"), "collections/habits/read.md");
  assert.equal(rowNotePath("collections/habits/", "read"), "collections/habits/read.md", "a trailing slash is fine");
  assert.equal(rowNotePath("data/budget.csv", "3"), null, "a CSV has no row notes");
});

test("rows are told apart from a collection's page and its templates", () => {
  assert.equal(isCollectionRow("collections/habits/read.md"), true);
  assert.equal(isCollectionRow("collections/habits/_index.md"), false, "the collection's own page");
  assert.equal(isCollectionRow("collections/habits/_template-habits.md"), false, "a row template");
  assert.equal(isCollectionRow("notes/ideas/second-brain.md"), false, "an ordinary note");
  assert.equal(isCollectionRow("collections/habits/nested/read.md"), false, "rows are one level deep");
});
