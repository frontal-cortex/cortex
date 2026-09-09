// Run with `npm run test:lib` (node's built-in runner; no bundler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMBED_MARK, extractEmbedLines, inflateWebBlocks, flattenWebBlocks, bookmarkLabel, soleWebLink,
} from "./webBlocks.ts";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const link = (href: string, ...content: unknown[]) => ({ type: "link", href, content });
const para = (...content: unknown[]) => ({ type: "paragraph", props: {}, content, children: [] });

test("an autolink alone on a line becomes a marked link for the parser", () => {
  const md = "Intro\n\n<https://www.youtube.com/watch?v=_x9y_z>\n\n  <https://a.b/c_d>  \nnot <https://a.b> alone\n";
  assert.equal(
    extractEmbedLines(md),
    `Intro\n\n[${EMBED_MARK}](https://www.youtube.com/watch?v=_x9y_z)\n\n[${EMBED_MARK}](https://a.b/c_d)\nnot <https://a.b> alone\n`,
  );
});

test("autolinks inside code fences are left alone", () => {
  const md = "```\n<https://x.y>\n```\n<https://x.y>\n~~~md\n<https://z>\n~~~\n";
  assert.equal(extractEmbedLines(md), "```\n<https://x.y>\n```\n[" + EMBED_MARK + "](https://x.y)\n~~~md\n<https://z>\n~~~\n");
});

test("a paragraph that is exactly one web link is a bookmark; the mark is an embed", () => {
  const blocks = [
    para(link("https://www.rust-lang.org/", text("Rust"))),
    para(text("  "), link("https://x.y/", text("rust-lang.org")), text(" ")),
    para(link("https://www.youtube.com/watch?v=abc", text(EMBED_MARK))),
    para(text("See "), link("https://x.y", text("this")), text(" now.")),
    para(link("child.md", text("Child"))),
    para(link("mailto:a@b.c", text("mail"))),
    para(text("https://bare.example")),
    para(),
  ];
  const out = inflateWebBlocks(blocks);
  assert.deepEqual(out[0], { type: "bookmark", props: { url: "https://www.rust-lang.org/", title: "Rust" } });
  assert.deepEqual(out[1], { type: "bookmark", props: { url: "https://x.y/", title: "rust-lang.org" } });
  assert.deepEqual(out[2], { type: "webEmbed", props: { url: "https://www.youtube.com/watch?v=abc" } });
  for (const i of [3, 4, 5, 6, 7]) assert.equal(out[i], blocks[i], `block ${i} untouched`);
});

test("the default label is dropped on load and restored on save", () => {
  assert.equal(bookmarkLabel("https://www.rust-lang.org/"), "rust-lang.org");
  assert.equal(bookmarkLabel("http://a.b/c/d?e=f"), "a.b/c/d?e=f");
  const [b] = inflateWebBlocks([para(link("https://www.rust-lang.org/", text("rust-lang.org")))]);
  assert.deepEqual(b, { type: "bookmark", props: { url: "https://www.rust-lang.org/", title: "" } });
  const [p] = flattenWebBlocks([b]);
  assert.deepEqual(p, para0(link("https://www.rust-lang.org/", text("rust-lang.org"))));
  // A label equal to the URL would make the exporter write a bare URL (no
  // longer a bookmark next time), so it is replaced by the default too.
  const [q] = flattenWebBlocks([{ type: "bookmark", props: { url: "https://x.y/", title: "https://x.y/" } }]);
  assert.deepEqual(q, para0(link("https://x.y/", text("x.y"))));
});

test("bookmark and embed round-trip through flatten → inflate", () => {
  const blocks = [
    { type: "bookmark", props: { url: "https://x.y/a", title: "A page" } },
    { type: "webEmbed", props: { url: "https://vimeo.com/1" } },
  ];
  const flat = flattenWebBlocks(blocks);
  assert.deepEqual(flat[0], para0(link("https://x.y/a", text("A page"))));
  assert.deepEqual(flat[1], para0(text("<https://vimeo.com/1>")));
  // What the exporter writes for flat[1] is the text verbatim; on the next
  // open extractEmbedLines turns it into the marked link the inflater reads.
  const reparsed = [para(link("https://x.y/a", text("A page"))), para(link("https://vimeo.com/1", text(EMBED_MARK)))];
  assert.deepEqual(inflateWebBlocks(reparsed), blocks);
});

test("an empty block leaves an empty paragraph; children are kept", () => {
  assert.deepEqual(flattenWebBlocks([{ type: "bookmark", props: { url: "" } }]), [para0()]);
  assert.deepEqual(flattenWebBlocks([{ type: "webEmbed", props: { url: " " } }]), [para0()]);
  const kid = para(text("kid"));
  const [nested] = flattenWebBlocks([{ type: "bookmark", props: { url: "https://x.y", title: "" }, children: [kid] }]);
  assert.deepEqual(nested.children, [kid]);
  const [inflated] = inflateWebBlocks([{ ...para(link("https://x.y", text("t"))), children: [kid] }]);
  assert.deepEqual(inflated, { type: "bookmark", props: { url: "https://x.y", title: "t" }, children: [kid] });
});

test("inflate recurses into list items and quotes without touching them", () => {
  const inner = para(link("https://x.y", text("t")));
  const list = { type: "bulletListItem", props: {}, content: [link("https://x.y", text("t"))], children: [inner] };
  const [out] = inflateWebBlocks([list]);
  assert.equal(out.type, "bulletListItem");
  assert.deepEqual(out.content, list.content, "a list item that is one link is not a card");
  assert.equal(out.children[0].type, "bookmark");
});

test("escaped parentheses in a destination are unescaped for the block", () => {
  const [b] = inflateWebBlocks([para(link("https://en.wikipedia.org/wiki/Rust_\\(programming_language\\)", text("Wiki")))]);
  assert.equal(b.props.url, "https://en.wikipedia.org/wiki/Rust_(programming_language)");
});

test("soleWebLink ignores whitespace and refuses non-web hrefs", () => {
  assert.deepEqual(soleWebLink([text(" "), link("https://x.y", text(" a "))]), { href: "https://x.y", text: "a" });
  assert.equal(soleWebLink([link("https://x.y", text("a")), link("https://x.y", text("b"))]), null);
  assert.equal(soleWebLink([link("ftp://x.y", text("a"))]), null);
  assert.equal(soleWebLink("nope"), null);
});

/** A flattened paragraph carries no props/children keys. */
function para0(...content: unknown[]) {
  return { type: "paragraph", content };
}
