// Run with `npm run test:lib` (node's built-in runner; no bundler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, buildLegend, colorOf, parseFilter, resolveLinks, nodeRadius } from "./graph.ts";
import type { GraphOptions } from "./graph.ts";
import type { NoteEntry } from "./commands";

const note = (path: string, title: string, tags: string[] = [], note_type: string | null = null): NoteEntry =>
  ({ path, title, tags, note_type, modified: 0, icon: null, parent: null });

const notes = [
  note("notes/hub.md", "Hub", ["project/alpha"]),
  note("notes/work/a.md", "Alpha", ["project/alpha", "work"]),
  note("notes/work/b.md", "Beta", ["work"], "meeting"),
  note("notes/c.md", "Gamma", ["idea"]),
  note("notes/lonely.md", "Lonely"),
];

// Raw rows as the indexer stores them: the target is the wiki-link text.
const raw: Array<[string, string]> = [
  ["notes/hub.md", "Alpha"],           // by title
  ["notes/hub.md", "b"],               // by stem
  ["notes/work/a.md", "notes/c.md"],   // by path
  ["notes/work/a.md", "alpha"],        // self-link, dropped
  ["notes/work/a.md", "Missing"],      // unresolved, dropped
  ["notes/hub.md", "ALPHA"],           // duplicate, collapsed
  ["notes/c.md", "hub"],
];

const opts = (o: Partial<GraphOptions> = {}): GraphOptions =>
  ({ mode: "global", centre: null, depth: 1, filter: "", showOrphans: true, ...o });

test("links resolve like vault::resolve and collapse duplicates", () => {
  assert.deepEqual(resolveLinks(notes, raw), [
    { source: "notes/hub.md", target: "notes/work/a.md" },
    { source: "notes/hub.md", target: "notes/work/b.md" },
    { source: "notes/work/a.md", target: "notes/c.md" },
    { source: "notes/c.md", target: "notes/hub.md" },
  ]);
});

test("global graph carries every note, degree counts both directions", () => {
  const g = buildGraph(notes, raw, opts());
  assert.equal(g.nodes.length, 5);
  assert.equal(g.links.length, 4);
  const deg = Object.fromEntries(g.nodes.map((n) => [n.title, n.degree]));
  assert.deepEqual(deg, { Hub: 3, Alpha: 2, Beta: 1, Gamma: 2, Lonely: 0 });
  assert.equal(g.nodes.find((n) => n.title === "Alpha")?.folder, "notes/work");
  assert.equal(g.nodes.every((n) => n.distance === undefined), true);
});

test("orphans toggle drops unlinked notes and counts them", () => {
  const g = buildGraph(notes, raw, opts({ showOrphans: false }));
  assert.deepEqual(g.nodes.map((n) => n.title), ["Gamma", "Hub", "Alpha", "Beta"]);
  assert.equal(g.hiddenOrphans, 1);
});

test("local graph walks depth hops from the centre in both directions", () => {
  const one = buildGraph(notes, raw, opts({ mode: "local", centre: "notes/work/b.md", depth: 1 }));
  assert.deepEqual(one.nodes.map((n) => [n.title, n.distance]), [["Hub", 1], ["Beta", 0]]);
  assert.equal(one.links.length, 1);

  const two = buildGraph(notes, raw, opts({ mode: "local", centre: "notes/work/b.md", depth: 2 }));
  assert.deepEqual(Object.fromEntries(two.nodes.map((n) => [n.title, n.distance])), { Hub: 1, Alpha: 2, Beta: 0, Gamma: 2 });

  // Depth is clamped to 1–3 and an unknown centre falls back to the global graph.
  assert.equal(buildGraph(notes, raw, opts({ mode: "local", centre: "notes/work/b.md", depth: 9 })).nodes.length, 4);
  assert.equal(buildGraph(notes, raw, opts({ mode: "local", centre: "nope.md" })).nodes.length, 5);
});

test("the centre survives the filter and the orphans toggle", () => {
  const g = buildGraph(notes, raw, opts({ mode: "local", centre: "notes/lonely.md", filter: "tag:work", showOrphans: false }));
  assert.deepEqual(g.nodes.map((n) => n.title), ["Lonely"]);
  assert.equal(g.hiddenOrphans, 0);
});

test("filter grammar: words, tag:, path:, type:, negation, quotes", () => {
  assert.deepEqual(parseFilter('al tag:#work -path:work/b "two words" type:Meeting -tag: TAGS:idea'), [
    { field: "title", value: "al", negated: false },
    { field: "tag", value: "#work", negated: false },
    { field: "path", value: "work/b", negated: true },
    { field: "title", value: "two words", negated: false },
    { field: "type", value: "meeting", negated: false },
    { field: "tag", value: "idea", negated: false },
  ]);
  const titles = (filter: string) => buildGraph(notes, raw, opts({ filter })).nodes.map((n) => n.title);
  assert.deepEqual(titles("a"), ["Gamma", "Alpha", "Beta"]);            // title substring, sorted by path
  assert.deepEqual(titles("tag:project"), ["Hub", "Alpha"]);            // parent tag matches children
  assert.deepEqual(titles("tag:work -type:meeting"), ["Alpha"]);
  assert.deepEqual(titles("path:work/"), ["Alpha", "Beta"]);
  assert.deepEqual(titles("-path:notes/work"), ["Gamma", "Hub", "Lonely"]);
  assert.deepEqual(titles('"lone"'), ["Lonely"]);
  // A filtered-out bridge is not walked through in local mode.
  const local = buildGraph(notes, raw, opts({ mode: "local", centre: "notes/work/b.md", depth: 3, filter: "-title:x -tag:project" }));
  assert.deepEqual(local.nodes.map((n) => n.title), ["Beta"]);
});

test("legend ranks keys by count and colours wrap past the palette", () => {
  const g = buildGraph(notes, raw, opts());
  const byTag = buildLegend(g.nodes, "tag");
  assert.deepEqual(byTag.map((e) => [e.key, e.count]), [["project/alpha", 2], ["idea", 1], ["work", 1]]);
  assert.equal(byTag[0].color, "blue");
  assert.equal(colorOf(g.nodes.find((n) => n.title === "Lonely")!, "tag", byTag), "gray");
  assert.equal(colorOf(g.nodes.find((n) => n.title === "Beta")!, "tag", byTag), byTag[2].color);

  const byFolder = buildLegend(g.nodes, "folder");
  assert.deepEqual(byFolder.map((e) => e.key), ["notes", "notes/work"]);
  assert.deepEqual(buildLegend(g.nodes, "none"), []);

  const many = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, title: "", icon: null, tags: [`t${i}`], folder: "", degree: 0 }));
  const legend = buildLegend(many, "tag");
  assert.equal(legend.length, 10);
  assert.equal(legend[8].color, legend[0].color);
});

test("node radius grows with the square root of the link count, capped", () => {
  assert.equal(nodeRadius(0), 7);
  assert.equal(nodeRadius(4), 13);
  assert.equal(nodeRadius(400), 24);
});
