import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenRichFormats, inflateRichFormats } from "./richFormats.ts";
import { imageAlignments } from "../../lib/alignment.ts";

const html = (blocks: any[]): string[] =>
  flattenRichFormats(blocks).map((b: any) => b.content?.[0]?.text ?? `<${b.type}>`);

const image = (props: Record<string, unknown>) => ({ type: "image", props, children: [] });

test("an image keeps its width, as before", () => {
  assert.deepEqual(html([image({ url: "assets/cat.png", name: "cat", previewWidth: 480 })]), [
    '<img src="assets/cat.png" alt="cat" width="480">',
  ]);
});

test("an image aligned but not resized still reaches the HTML form", () => {
  assert.deepEqual(html([image({ url: "assets/cat.png", textAlignment: "center" })]), [
    '<p align="center" style="text-align: center"><img src="assets/cat.png"></p>',
  ]);
});

test("a captioned image is wrapped in a div, which may hold a figure", () => {
  assert.deepEqual(
    html([image({ url: "assets/cat.png", previewWidth: 300, caption: "a cat", textAlignment: "right" })]),
    ['<div align="right" style="text-align: right"><figure><img src="assets/cat.png" width="300"><figcaption>a cat</figcaption></figure></div>'],
  );
});

test("a left-aligned or justified image is written as plainly as before", () => {
  assert.deepEqual(html([image({ url: "a.png", textAlignment: "left" })]), ["<image>"]);
  assert.deepEqual(html([image({ url: "a.png", textAlignment: "justify" })]), ["<image>"]);
});

test("an aligned paragraph and heading keep their own tag", () => {
  const para = { type: "paragraph", props: { textAlignment: "center" }, content: [{ type: "text", text: "hi", styles: {} }] };
  const head = { type: "heading", props: { textAlignment: "right", level: 2 }, content: [{ type: "text", text: "Title", styles: { bold: true } }] };
  assert.deepEqual(html([para, head]), [
    '<p align="center" style="text-align: center">hi</p>',
    '<h2 align="right" style="text-align: right"><strong>Title</strong></h2>',
  ]);
});

test("an empty aligned paragraph is left alone, so it survives the round trip", () => {
  assert.deepEqual(html([{ type: "paragraph", props: { textAlignment: "center" }, content: [] }]), ["<paragraph>"]);
});

test("what the save writes is what the load reads back", () => {
  const blocks = [
    image({ url: "assets/cat.png", name: "cat", previewWidth: 480, textAlignment: "center" }),
    image({ url: "assets/dog.png", textAlignment: "right" }),
    image({ url: "assets/cat.png" }),
  ];
  // An unaligned, unsized image stays a plain markdown image; only the two
  // wrapped ones carry an alignment into the file.
  const md = html(blocks).map((line) => (line === "<image>" ? "![](assets/cat.png)" : line)).join("\n\n");
  // The parser hands back plain image blocks; the alignments ride alongside.
  const parsed = [
    image({ url: "assets/cat.png", name: "cat", previewWidth: 480 }),
    image({ url: "assets/dog.png" }),
    image({ url: "assets/cat.png" }),
  ];
  const back = inflateRichFormats(parsed, imageAlignments(md));
  assert.deepEqual(back.map((b: any) => b.props.textAlignment), ["center", "right", undefined]);
});
