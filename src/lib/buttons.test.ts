import test from "node:test";
import assert from "node:assert/strict";
import { parseButtonSpec, serializeButtonSpec, expandPlaceholders, runButton, rowOf, collectButtons } from "./buttons.ts";
import type { ButtonDeps } from "./buttons.ts";

const fence = `label: New expense
action: add-row
collection: budget
values: {kind: expense, date: "{{today}}", note: "a, b"}
template: quick
open: true
`;

test("a button fence parses, flow and block value maps alike, and round-trips", () => {
  const { spec, unknownKeys } = parseButtonSpec(fence);
  assert.equal(spec.label, "New expense");
  assert.equal(spec.action, "add-row");
  assert.equal(spec.collection, "budget");
  assert.deepEqual(spec.values, { kind: "expense", date: "{{today}}", note: "a, b" });
  assert.equal(spec.template, "quick");
  assert.equal(spec.open, true);
  assert.deepEqual(unknownKeys, []);
  assert.equal(parseButtonSpec(serializeButtonSpec(spec)).spec.values?.note, "a, b");

  const block = parseButtonSpec("label: Log\naction: log\ncollection: collections/habits/\nitem: Read\nvalues:\n  mood: good\n  energy: 7\ncolour: red\n");
  assert.equal(block.spec.collection, "habits");
  assert.deepEqual(block.spec.values, { mood: "good", energy: "7" });
  assert.deepEqual(block.unknownKeys, ["colour"]);
});

test("placeholders expand relative to now and leave the rest alone", () => {
  const now = new Date(2026, 8, 10, 9, 5);
  assert.equal(expandPlaceholders("{{today}}", now), "2026-09-10");
  assert.equal(expandPlaceholders("{{today-9}}", now), "2026-09-01");
  assert.equal(expandPlaceholders("{{date+1}} at {{time}}", now), "2026-09-11 at 09:05");
  assert.equal(expandPlaceholders("{{title}}", now), "{{title}}");
});

function deps(log: string[]): ButtonDeps {
  return {
    async addRow(s, id, f) { log.push(`addRow ${s} ${id} ${JSON.stringify(f)}`); },
    async addRowFromTemplate(s, id, t, f) { log.push(`tpl ${s} ${id} ${t} ${JSON.stringify(f)}`); },
    async setCell(s, id, k, v) { log.push(`set ${s} ${id} ${k}=${v}`); },
    async listTrackers() { return [{ collection: "habits", name: "Today", spec: "type: tracker\nlog: collections/habit-log\ndate: date\ndone: done\n" }]; },
    async trackerToggle(l, d, dn, date, item) { log.push(`log ${l} ${d} ${dn} ${date} ${item}`); },
    async resolveNote(t) { return t === "Welcome" ? "notes/welcome.md" : null; },
    openNote(p, v) { log.push(`open ${p}${v ? ` view=${v}` : ""}`); },
    async openExternal(u) { log.push(`url ${u}`); return u.startsWith("http"); },
    now: () => new Date(2026, 8, 10),
    newId: () => "row-x",
  };
}

test("each action calls the operation it stands for", async () => {
  const log: string[] = [];
  const d = deps(log);
  await runButton(parseButtonSpec(fence).spec, "notes/a.md", d);
  assert.equal(log[0], 'tpl collections/budget row-x quick {"kind":"expense","date":"2026-09-10","note":"a, b"}');
  assert.equal(log[1], "open collections/budget/row-x.md");

  await runButton({ label: "x", action: "add-row", collection: "tasks", values: { status: "todo" } }, "n.md", d);
  assert.equal(log[2], 'addRow collections/tasks row-x {"title":"Untitled","created":"2026-09-10","status":"todo"}');

  await runButton({ label: "x", action: "open", collection: "budget", view: "Ledger" }, "n.md", d);
  assert.equal(log[3], "open collections/budget/_index.md view=Ledger");
  await runButton({ label: "x", action: "open", target: "Welcome" }, "n.md", d);
  assert.equal(log[4], "open notes/welcome.md");
  await assert.rejects(runButton({ label: "x", action: "open", target: "Nope" }, "n.md", d), /No note titled/);

  await runButton({ label: "x", action: "log", collection: "habits", item: "Read" }, "n.md", d);
  assert.equal(log[5], "log collections/habit-log date done 2026-09-10 Read");
  await assert.rejects(runButton({ label: "x", action: "log", collection: "tasks", item: "Read" }, "n.md", d), /no tracker view/);

  await runButton({ label: "x", action: "set", values: { paid: "true" } }, "collections/budget-bills/rent.md", d);
  assert.equal(log[6], "set collections/budget-bills rent paid=true");
  await assert.rejects(runButton({ label: "x", action: "set", values: { paid: "true" } }, "notes/a.md", d), /row's page/);

  await runButton({ label: "x", action: "url", url: "https://example.com" }, "n.md", d);
  assert.equal(log[7], "url https://example.com");
  await assert.rejects(runButton({ label: "x", action: "url", url: "file:///etc/passwd" }, "n.md", d), /Only http/);
});

test("add-row without a template uses the collection's own row template when it exists", async () => {
  const log: string[] = [];
  const d = { ...deps(log), listRowTemplates: async (s: string) => (s === "collections/budget" ? ["budget", "refund"] : []) };
  await runButton({ label: "x", action: "add-row", collection: "budget", values: { kind: "expense" } }, "n.md", d);
  assert.equal(log[0], 'tpl collections/budget row-x budget {"kind":"expense"}');
  await runButton({ label: "x", action: "add-row", collection: "tasks", values: {} }, "n.md", d);
  assert.match(log[1], /^addRow collections\/tasks row-x /);
});

test("rowOf and collectButtons", () => {
  assert.deepEqual(rowOf("collections/budget/rent.md"), { source: "collections/budget", id: "rent" });
  assert.equal(rowOf("collections/budget/_index.md"), null);
  assert.equal(rowOf("notes/a.md"), null);
  const doc = [{ type: "paragraph" }, { type: "cortexButton", props: { spec: "label: A\naction: url\nurl: https://a" } },
    { type: "columnList", children: [{ type: "column", children: [{ type: "cortexButton", props: { spec: "label: B\naction: open\ntarget: Welcome" } }] }] }];
  assert.deepEqual(collectButtons(doc).map((b) => b.label), ["A", "B"]);
});
