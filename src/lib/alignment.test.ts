import { test } from "node:test";
import assert from "node:assert/strict";
import { alignOf, imageAlignOf, alignedHtml, imageAlignments, applyImageAlignments } from "./alignment.ts";

test("left and unknown values are the default", () => {
  assert.equal(alignOf({ textAlignment: "left" }), "");
  assert.equal(alignOf({}), "");
  assert.equal(alignOf(undefined), "");
  assert.equal(alignOf({ textAlignment: "sideways" }), "");
  assert.equal(alignOf({ textAlignment: "center" }), "center");
});

test("an image is never justified", () => {
  assert.equal(imageAlignOf({ textAlignment: "justify" }), "");
  assert.equal(imageAlignOf({ textAlignment: "right" }), "right");
});

test("both spellings are written, for GitHub and for the parser", () => {
  assert.equal(
    alignedHtml("p", "center", "hi"),
    '<p align="center" style="text-align: center">hi</p>',
  );
});

test("alignments are read off the markdown, per image", () => {
  const md = [
    '<p align="center" style="text-align: center"><img src="assets/a.png" alt="a" width="480"></p>',
    "",
    "![b](assets/b.png)",
    "",
    '<div align="right" style="text-align: right"><figure><img src="assets/c.png"><figcaption>c</figcaption></figure></div>',
    "",
    '<p align="center" style="text-align: center"><img src="assets/a.png"></p>',
  ].join("\n");
  const found = imageAlignments(md);
  assert.deepEqual(found.get("assets/a.png"), ["center", "center"]);
  assert.equal(found.get("assets/b.png"), undefined);
  assert.deepEqual(found.get("assets/c.png"), ["right"]);
});

test("a file hand-written with only one spelling still opens aligned", () => {
  assert.deepEqual(
    imageAlignments('<p align="right"><img src="x.png"></p>').get("x.png"),
    ["right"],
  );
  assert.deepEqual(
    imageAlignments('<div style="text-align:center"><img src="x.png"></div>').get("x.png"),
    ["center"],
  );
});

test("the alignments go back on the image blocks in document order", () => {
  const blocks = [
    { type: "image", props: { url: "assets/a.png" } },
    { type: "paragraph", content: [], children: [{ type: "image", props: { url: "assets/c.png" } }] },
    { type: "image", props: { url: "assets/a.png" } },
    { type: "image", props: { url: "assets/b.png" } },
  ];
  const out = applyImageAlignments(blocks, new Map([
    ["assets/a.png", ["center", "right"]],
    ["assets/c.png", ["right"]],
  ] as [string, ("center" | "right")[]][]));
  assert.equal(out[0].props.textAlignment, "center");
  assert.equal(out[1].children[0].props.textAlignment, "right");
  assert.equal(out[2].props.textAlignment, "right");
  assert.equal(out[3].props.textAlignment, undefined);
  assert.equal(blocks[0].props.textAlignment, undefined, "the input is left alone");
});

test("nothing to restore means the blocks are handed back unchanged", () => {
  const blocks = [{ type: "image", props: { url: "a.png" } }];
  assert.equal(applyImageAlignments(blocks, new Map()), blocks);
});
