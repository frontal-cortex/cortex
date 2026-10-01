// Run with `npm run test:lib` (node's built-in runner; no bundler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { breadcrumbFor, folderContents } from "./breadcrumb.ts";
import type { NoteEntry } from "./commands.ts";

const note = (path: string, title: string, extra: Partial<NoteEntry> = {}): NoteEntry => ({
  path, title, note_type: null, tags: [], modified: 0, created: null, icon: null, parent: null, ...extra,
});

const notes = [
  note("notes/inbox.md", "Inbox"),
  note("notes/work/plan.md", "Plan", { icon: "🗺️" }),
  note("notes/work/q3/okrs.md", "OKRs"),
  note("templates/daily.md", "Daily"),
  note("AGENTS.md", "Agents"),
  // A database under a folder, one under that database, and a row in each.
  note("collections/budget/_index.md", "Budget", { parent: "notes/work", icon: "💰" }),
  note("collections/expenses/_index.md", "Expenses", { parent: "budget" }),
  note("collections/expenses/row-1.md", "Coffee"),
  note("collections/budget/row-2.md", "", { }),
  // A database whose parent names nothing that exists, and two in a cycle.
  note("collections/orphan/_index.md", "Orphan", { parent: "gone" }),
  note("collections/a/_index.md", "A", { parent: "b" }),
  note("collections/b/_index.md", "B", { parent: "a" }),
  // Rows only, no page yet.
  note("collections/habit-log/2026-01-01.md", "Jan 1"),
];

const labels = (path: string) => breadcrumbFor(path, notes).map((c) => `${c.kind}:${c.label}`);

test("a note under folders: each folder, the notes/ root left out", () => {
  assert.deepEqual(labels("notes/inbox.md"), ["note:Inbox"]);
  assert.deepEqual(labels("notes/work/q3/okrs.md"), ["dir:work", "dir:q3", "note:OKRs"]);
  assert.deepEqual(breadcrumbFor("notes/work/q3/okrs.md", notes).map((c) => c.path), ["notes/work/", "notes/work/q3/", "notes/work/q3/okrs.md"]);
});

test("other roots are named; a root-level file stands alone", () => {
  assert.deepEqual(labels("templates/daily.md"), ["dir:Templates", "note:Daily"]);
  assert.deepEqual(labels("AGENTS.md"), ["note:Agents"]);
  assert.deepEqual(labels(""), []);
});

test("a row sits under its database, a database under its parent", () => {
  assert.deepEqual(labels("collections/expenses/row-1.md"), ["dir:work", "collection:Budget", "collection:Expenses", "note:Coffee"]);
  assert.deepEqual(labels("collections/expenses/_index.md"), ["dir:work", "collection:Budget", "collection:Expenses"]);
  const crumbs = breadcrumbFor("collections/expenses/row-1.md", notes);
  assert.equal(crumbs[1].kind === "collection" && crumbs[1].icon, "💰");
  assert.equal(crumbs[1].path, "collections/budget/_index.md");
});

test("untitled rows and pageless databases fall back to the file name", () => {
  assert.deepEqual(labels("collections/budget/row-2.md"), ["dir:work", "collection:Budget", "note:row 2"]);
  assert.deepEqual(labels("collections/habit-log/2026-01-01.md"), ["collection:habit log", "note:Jan 1"]);
});

test("an unknown parent ends the chain; a cycle does not loop", () => {
  assert.deepEqual(labels("collections/orphan/_index.md"), ["collection:Orphan"]);
  assert.deepEqual(labels("collections/a/_index.md"), ["collection:B", "collection:A"]);
});

test("a note the list does not know yet still gets a crumb", () => {
  assert.deepEqual(labels("notes/work/new-idea.md"), ["dir:work", "note:new idea"]);
});

test("folder contents follow the sidebar: folders, databases, then notes", () => {
  const names = (dir: string) => folderContents(dir, notes, ["notes/work/empty/"]).map((n) => `${n.type}:${n.name}`);
  assert.deepEqual(names("notes/work/"), ["dir:empty", "dir:q3", "collection:Budget", "file:Plan"]);
  assert.deepEqual(names("templates/"), ["file:Daily"]);
  assert.deepEqual(names("notes/nowhere/"), []);
});
