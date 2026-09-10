import test from "node:test";
import assert from "node:assert/strict";
import { inflateColumns, flattenColumns, parseRatios, newColumnList } from "./columns.ts";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text, styles: {} }] });
const h = (text: string) => ({ type: "heading", props: { level: 2 }, content: [{ type: "text", text, styles: {} }] });

test("a columns fence becomes a columnList with the ratios and content it declares", () => {
  const doc = [p("before"), p("::: columns 1 2 1"), h("Left"), p("l1"), p(":::"), p("mid"), p(":::"), p("::: end"), p("after")];
  const out = inflateColumns(doc);
  assert.equal(out.length, 3);
  const list = out[1];
  assert.equal(list.type, "columnList");
  assert.equal(list.props.ratios, "1 2 1");
  assert.equal(list.children.length, 3);
  assert.deepEqual(list.children.map((c: any) => c.props.width), ["1", "2", "1"]);
  assert.equal(list.children[0].children.length, 2);
  assert.equal(list.children[1].children[0].content[0].text, "mid");
  assert.equal(list.children[2].children.length, 1, "an empty column gets an empty paragraph to type into");
  assert.equal(out[2].content[0].text, "after");
});

test("no `::: end` closes at the document's end; no ratios means equal columns", () => {
  const out = inflateColumns([p("::: columns"), p("a"), p(":::"), p("b")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].props.ratios, "1 1");
  assert.deepEqual(parseRatios("2 1", 2), [2, 1]);
  assert.deepEqual(parseRatios("2", 3), [2, 1, 1], "a short list is padded with 1s");
  assert.deepEqual(parseRatios("", 2), [1, 1]);
});

test("flattening writes the fence lines back, and the round trip is stable", () => {
  const doc = [p("before"), p("::: columns 1 2"), h("Left"), p("l1"), p(":::"), p("mid"), p("::: end"), p("after")];
  const back = flattenColumns(inflateColumns(doc));
  assert.deepEqual(back.map((b) => b.content?.[0]?.text), ["before", "::: columns 1 2", "Left", "l1", ":::", "mid", "::: end", "after"]);
  // Equal columns are written without ratios.
  const eq = flattenColumns([newColumnList(3)]);
  assert.deepEqual(eq.map((b) => b.content?.[0]?.text ?? ""), ["::: columns", ":::", ":::", "::: end"]);
});

test("a column dragged out of its list is just its blocks; nested lists inside columns flatten too", () => {
  const stray = { type: "column", props: { width: "1" }, children: [p("x")] };
  assert.deepEqual(flattenColumns([stray]).map((b) => b.content[0].text), ["x"]);
  const nested = { type: "columnList", props: { ratios: "1 1" }, children: [
    { type: "column", props: { width: "1" }, children: [{ type: "bulletListItem", content: [], children: [p("deep")] }] },
    { type: "column", props: { width: "1" }, children: [p("y")] },
  ] };
  const out = flattenColumns([nested]);
  assert.equal(out[0].content[0].text, "::: columns");
  assert.equal(out[1].type, "bulletListItem");
});
