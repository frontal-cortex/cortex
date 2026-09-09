// Run with `npm run test:lib` (node's built-in runner; no bundler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, parseExplorerSort, formatExplorerSort, sortNotes } from "./fileTree.ts";
import type { NoteEntry } from "./commands.ts";

const note = (path: string, title: string, extra: Partial<NoteEntry> = {}): NoteEntry => ({
  path, title, note_type: null, tags: [], modified: 0, created: null, icon: null, parent: null, ...extra,
});

const notes = [
  note("notes/b.md", "Beta", { modified: 20, created: "2024-02-01", note_type: "meeting" }),
  note("notes/a.md", "Alpha", { modified: 30, created: "2024-03-01" }),
  note("notes/c.md", "Gamma", { modified: 10, created: null, note_type: "note" }),
  note("notes/sub/d.md", "Delta", { modified: 40 }),
];

const titles = (sort: string) =>
  buildTree(notes, "notes/", [], parseExplorerSort(sort)).map((n) => n.name);

test("parse tolerates bare fields, case and junk", () => {
  assert.deepEqual(parseExplorerSort("modified-desc"), { field: "modified", dir: "desc" });
  assert.deepEqual(parseExplorerSort("Created"), { field: "created", dir: "asc" });
  assert.deepEqual(parseExplorerSort("size-desc"), { field: "name", dir: "asc" });
  assert.deepEqual(parseExplorerSort(undefined), { field: "name", dir: "asc" });
  assert.equal(formatExplorerSort({ field: "type", dir: "desc" }), "type-desc");
});

test("folders stay first and alphabetical whatever the sort", () => {
  assert.deepEqual(titles("name-asc"), ["sub", "Alpha", "Beta", "Gamma"]);
  assert.deepEqual(titles("name-desc"), ["sub", "Gamma", "Beta", "Alpha"]);
  assert.deepEqual(titles("modified-desc"), ["sub", "Alpha", "Beta", "Gamma"]);
  assert.deepEqual(titles("modified-asc"), ["sub", "Gamma", "Beta", "Alpha"]);
});

test("missing created / type sort last in both directions", () => {
  assert.deepEqual(titles("created-asc"), ["sub", "Beta", "Alpha", "Gamma"]);
  assert.deepEqual(titles("created-desc"), ["sub", "Alpha", "Beta", "Gamma"]);
  assert.deepEqual(titles("type-asc"), ["sub", "Beta", "Gamma", "Alpha"]);
  assert.deepEqual(titles("type-desc"), ["sub", "Gamma", "Beta", "Alpha"]);
});

test("name breaks ties so the order is stable", () => {
  const same = [note("notes/y.md", "Y", { modified: 5 }), note("notes/x.md", "X", { modified: 5 })]
    .map((n) => ({ note: n, name: n.title }));
  assert.deepEqual(sortNotes(same, { field: "modified", dir: "desc" }).map((s) => s.name), ["X", "Y"]);
});
