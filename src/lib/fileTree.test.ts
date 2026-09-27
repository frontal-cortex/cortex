// Run with `npm run test:lib` (node's built-in runner; no bundler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, parseExplorerSort, formatExplorerSort, sortNotes, folderNotePath, displayTitle } from "./fileTree.ts";
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

// ── Folder notes ──────────────────────────────────────────────────────────────

test("a folder's _index.md is the folder's page, not a note inside it", () => {
  const tree = buildTree([
    note("notes/work/_index.md", "Work 🚀"),
    note("notes/work/a.md", "Alpha"),
    note("notes/loose.md", "Loose"),
  ], "notes/");
  const work = tree[0];
  assert.equal(work.type, "dir");
  if (work.type !== "dir") return;
  assert.equal(work.name, "Work 🚀", "the page's title names the folder");
  assert.equal(work.note?.path, "notes/work/_index.md");
  assert.deepEqual(work.children.map((n) => n.name), ["Alpha"], "the page is not listed among the folder's notes");
});

test("an untitled folder page keeps the folder's name, and Obsidian's folder/folder.md counts too", () => {
  const tree = buildTree([
    note("notes/work/_index.md", "Untitled"),
    note("notes/ideas/ideas.md", "Ideas"),
    note("notes/ideas/one.md", "One"),
    note("notes/plain/x.md", "X"),
  ], "notes/");
  const [ideas, plain, work] = tree;
  assert.equal(work.type === "dir" && work.name, "work");
  assert.equal(work.type === "dir" && work.note?.path, "notes/work/_index.md");
  assert.equal(ideas.type === "dir" && ideas.note?.path, "notes/ideas/ideas.md");
  assert.deepEqual(ideas.type === "dir" ? ideas.children.map((n) => n.name) : [], ["One"]);
  assert.equal(plain.type === "dir" && plain.note, null);
});

test("_index.md prevails when a folder has both conventions", () => {
  const tree = buildTree([
    note("notes/work/work.md", "Old style"),
    note("notes/work/_index.md", "New style"),
  ], "notes/");
  const work = tree[0];
  assert.equal(work.type === "dir" && work.note?.path, "notes/work/_index.md");
  assert.deepEqual(work.type === "dir" ? work.children.map((n) => n.name) : [], ["Old style"]);
});

test("folderNotePath and displayTitle agree on what a folder page is called", () => {
  assert.equal(folderNotePath("notes/work/"), "notes/work/_index.md");
  assert.equal(folderNotePath("notes/work"), "notes/work/_index.md");
  assert.equal(displayTitle(note("notes/work/_index.md", "")), "work");
  assert.equal(displayTitle(note("notes/my-stuff/_index.md", "Untitled")), "my stuff");
  assert.equal(displayTitle(note("notes/untitled-2026-09-27.md", "")), "Untitled");
});
