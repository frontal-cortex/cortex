// Run with `npm run test:lib` (node's built-in runner; no bundler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMath, inflateMath, flattenMath, restoreMath, MATH_FENCE } from "./math.ts";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const para = (...content: unknown[]) => ({ type: "paragraph", props: {}, content, children: [] });

test("inline $…$ becomes a placeholder and back", () => {
  const { md, spans } = extractMath("Energy $E = mc^2$ here.");
  assert.equal(spans.length, 1);
  assert.deepEqual(spans[0], { latex: "E = mc^2", display: false });
  assert.match(md, /^Energy \uE0000\uE001 here\.$/);

  const blocks = inflateMath([para(text(md))], spans);
  assert.deepEqual(blocks[0].content, [
    text("Energy "),
    { type: "inlineMath", props: { latex: "E = mc^2", display: false } },
    text(" here."),
  ]);
  assert.deepEqual(flattenMath(blocks)[0].content, [text("Energy "), text("$E = mc^2$"), text(" here.")]);
});

test("LaTeX escapes and emphasis characters survive the round trip", () => {
  const src = "Set $\\{a_1, b_*\\}$ and $x_1 \\cdot y_2$.";
  const { md, spans } = extractMath(src);
  assert.equal(spans[0].latex, "\\{a_1, b_*\\}");
  assert.equal(spans[1].latex, "x_1 \\cdot y_2");
  assert.ok(!md.includes("_"), "no underscore left for the Markdown parser to see");
  const flat = flattenMath(inflateMath([para(text(md))], spans));
  assert.equal(flat[0].content.map((c: { text: string }) => c.text).join(""), src);
});

test("dollar amounts are not math", () => {
  const { md, spans } = extractMath("It costs $5 and $10, or $ 3.");
  assert.equal(spans.length, 0);
  assert.equal(md, "It costs $5 and $10, or $ 3.");
  // Closing `$` directly before a digit does not close either (Pandoc rule).
  assert.equal(extractMath("$5$10").spans.length, 0);
});

test("code spans and code fences are left alone", () => {
  const src = "Use `$x$` literally.\n\n```sh\necho $HOME $PATH\n```\n\nBut $y$ renders.";
  const { md, spans } = extractMath(src);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].latex, "y");
  assert.ok(md.includes("`$x$`"));
  assert.ok(md.includes("echo $HOME $PATH"));
});

test("a $$ block on its own lines becomes a mathBlock and is written back as $$", () => {
  const src = "Before\n\n$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$\n\nAfter";
  const { md, spans } = extractMath(src);
  assert.equal(spans.length, 0);
  assert.equal(md, "Before\n\n```" + MATH_FENCE + "\n\\int_0^1 x\\,dx = \\frac{1}{2}\n```\n\nAfter");

  const parsed = [
    para(text("Before")),
    { type: "codeBlock", props: { language: MATH_FENCE }, content: [text("\\int_0^1 x\\,dx = \\frac{1}{2}")], children: [] },
    para(text("After")),
  ];
  const blocks = inflateMath(parsed, spans);
  assert.deepEqual(blocks[1], { type: "mathBlock", props: { latex: "\\int_0^1 x\\,dx = \\frac{1}{2}" } });

  const flat = flattenMath(blocks);
  assert.equal(flat[1].type, "codeBlock");
  assert.equal(flat[1].props.language, MATH_FENCE);

  // What BlockNote's exporter emits for that code block, and what we ship.
  const exported = "Before\n\n```" + MATH_FENCE + "\n\\int_0^1 x\\,dx = \\frac{1}{2}\n```\n\nAfter\n";
  assert.equal(restoreMath(exported), src + "\n");
});

test("multi-line and single-line $$ forms, and an unclosed $$", () => {
  const multi = extractMath("$$\na \\\\\nb\n$$");
  assert.equal(multi.md, "```" + MATH_FENCE + "\na \\\\\nb\n```");
  const single = extractMath("$$ E = mc^2 $$");
  assert.equal(single.md, "```" + MATH_FENCE + "\nE = mc^2\n```");
  const open = extractMath("$$\nnever closed");
  assert.equal(open.md, "$$\nnever closed");
  assert.equal(open.spans.length, 0);
});

test("restoreMath handles an empty equation and longer fences", () => {
  assert.equal(restoreMath("```" + MATH_FENCE + "\n```\n"), "$$\n\n$$\n");
  assert.equal(restoreMath("````" + MATH_FENCE + "\na ``` b\n````\n"), "$$\na ``` b\n$$\n");
  assert.equal(restoreMath("```sh\necho hi\n```\n"), "```sh\necho hi\n```\n");
});

test("inline $$…$$ mid-line keeps its display form", () => {
  const { md, spans } = extractMath("so $$\\sum_i x_i$$ then");
  assert.deepEqual(spans, [{ latex: "\\sum_i x_i", display: true }]);
  const flat = flattenMath(inflateMath([para(text(md))], spans));
  assert.equal(flat[0].content.map((c: { text: string }) => c.text).join(""), "so $$\\sum_i x_i$$ then");
});

test("math inside nested blocks, links and table cells", () => {
  const { md, spans } = extractMath("- item $a$\n  - child $b$");
  const lines = md.split("\n");
  const blocks = [
    {
      type: "bulletListItem", props: {}, content: [text(lines[0].slice(2))],
      children: [{ type: "bulletListItem", props: {}, content: [text(lines[1].slice(4))], children: [] }],
    },
  ];
  const inflated = inflateMath(blocks, spans);
  assert.equal(inflated[0].content[1].props.latex, "a");
  assert.equal(inflated[0].children[0].content[1].props.latex, "b");

  const cell = extractMath("$c$");
  const table = [{
    type: "table", props: {},
    content: { type: "tableContent", rows: [{ cells: [[text(cell.md)], [text("plain")]] }] },
    children: [],
  }];
  const t = inflateMath(table, cell.spans);
  assert.deepEqual(t[0].content.rows[0].cells[0], [{ type: "inlineMath", props: { latex: "c", display: false } }]);
  assert.deepEqual(flattenMath(t)[0].content.rows[0].cells[0], [text("$c$")]);

  const link = extractMath("$d$");
  const linked = inflateMath([para({ type: "link", href: "x", content: [text(link.md)] })], link.spans);
  assert.equal(linked[0].content[0].content[0].props.latex, "d");
});

test("text with code style is never expanded", () => {
  const { md, spans } = extractMath("$e$");
  const blocks = inflateMath([para(text(md, { code: true }))], spans);
  assert.equal(blocks[0].content[0].type, "text");
});
