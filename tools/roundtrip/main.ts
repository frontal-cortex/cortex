// Round-trip harness for the editor's Markdown boundary — run via run.sh.
// Exercises the same inflate/flatten chain Editor.tsx uses around BlockNote's
// parser and exporter, without the app or a vault.
import { BlockNoteEditor } from "@blocknote/core";
import { cortexSchema } from "../../src/components/Shell/schema";
import { inflateRichFormats, flattenRichFormats } from "../../src/components/Shell/richFormats";
import { inflateCallouts, flattenCallouts } from "../../src/components/Shell/CalloutBlock";
import { extractEmbedLines, inflateWebBlocks, flattenWebBlocks } from "../../src/lib/webBlocks";

const editor = BlockNoteEditor.create({ schema: cortexSchema });
const out: string[] = [];
const log = (s: string) => out.push(s);
const strip = (b: any) => JSON.parse(JSON.stringify(b, (k, v) => (k === "id" ? undefined : v)));
const load = (md: string) => inflateRichFormats(inflateCallouts(inflateWebBlocks(editor.tryParseMarkdownToBlocks(extractEmbedLines(md)))));
const save = (blocks: any[]) => editor.blocksToMarkdownLossy(flattenRichFormats(flattenCallouts(flattenWebBlocks(blocks))) as any);

// 1. Canonical files: open, save without edits → byte-identical.
const files: Record<string, string> = {
  underline: "Some <u>underlined</u> text.\n",
  underlineBold: "Some <u>**under bold** and plain</u> text.\n",
  highlight: "Some ==highlighted== text.\n",
  highlightBold: "Some ==**bold** and plain== text.\n",
  highlightLink: "See ==[a link](https://x.y)== now.\n",
  both: "Both ==<u>under and high</u>== here.\n",
  mixed: "==a<u>b</u>c==\n",
  notHighlight: "if a == b and c == d then\n",
  codeEquals: "Code `a == b == c` stays.\n",
  fence: "```js\nif (a == b == c) {}\n```\n",
  details: "<details><summary>Toggle me</summary>\n\n* child one\n* child two\n\n</details>\n",
  detailsStyled: "<details><summary><strong>Bold</strong> and <u>under</u> and ==high== and <a href=\"https://x.y\">link</a></summary>\n\nbody\n\n</details>\n",
  detailsEmpty: "<details><summary>Nothing inside</summary>\n\n</details>\n",
  detailsNested: "<details><summary>Outer</summary>\n\n<details><summary>Inner</summary>\n\ndeep\n\n</details>\n\n</details>\n",
  detailsHeading: "<details><summary><h2>Toggle heading</h2></summary>\n\nbody\n\n</details>\n",
  imgWidth: '<img src="assets/x.png" alt="pic" width="480">\n',
  imgWidthNoAlt: '<img src="assets/x.png" width="320">\n',
  imgWidthCaption: '<figure><img src="assets/x.png" alt="pic" width="480"><figcaption>cap</figcaption></figure>\n',
  imgPlain: "![pic](assets/x.png)\n",
  callout: "> [!tip] Keep ==it== <u>short</u>.\n",
  table: "| a          | b          |\n| ---------- | ---------- |\n| ==hi==     | <u>u</u>   |\n",
  list: "* one ==two== <u>three</u>\n  * nested ==x==\n",
  quoteHighlight: "> quoted ==text==\n",
  heading: "# Head ==light==\n",
  // Bookmark: a paragraph that is exactly one web link. Embed: an autolink
  // alone on a line. Anything else with a URL stays what it was.
  bookmark: "[Rust](https://www.rust-lang.org/)\n",
  bookmarkDefaultLabel: "[rust-lang.org](https://www.rust-lang.org/)\n",
  bookmarkParens: "[Wiki](https://en.wikipedia.org/wiki/Rust_\\(programming_language\\))\n",
  webEmbed: "<https://www.youtube.com/watch?v=_x9y_z-AB>\n",
  webEmbedInFence: "```\n<https://www.youtube.com/watch?v=x>\n```\n",
  bareUrl: "https://example.com/\n",
  linkInProse: "See [Rust](https://www.rust-lang.org/) now.\n",
  relativeLink: "[Child](child.md)\n",
  linkInList: "* [Rust](https://www.rust-lang.org/)\n",
};
// Non-canonical spellings settle into the canonical one on the first save and
// are stable after that.
const normalizes: Record<string, [string, string]> = {
  bothReversed: ["Both <u>==under and high==</u> here.\n", "Both ==<u>under and high</u>== here.\n"],
  // BlockNote's own exporter splits a link whose text mixes styles (see
  // `[**b** c](u)`); a partly highlighted link degrades the same way.
  linkBoldNative: ["See [**b** c](https://x.y) now.\n", "See **[b](https://x.y)**[ c](https://x.y) now.\n"],
  highlightInLink: ["See [==hot== link](https://x.y) now.\n", "See [==](https://x.y)[hot](https://x.y)[==](https://x.y)[ link](https://x.y) now.\n"],
};
let fails = 0;
for (const [name, [md, want]] of Object.entries(normalizes)) {
  const first = save(load(md));
  const second = save(load(first));
  const ok = first === want && second === want;
  if (!ok) fails++;
  log(`${ok ? "PASS" : "FAIL"} normalizes/${name}${ok ? "" : `\n  1st: ${JSON.stringify(first)}\n  2nd: ${JSON.stringify(second)}`}`);
}
for (const [name, md] of Object.entries(files)) {
  try {
    const blocks = load(md);
    const back = save(blocks);
    const ok = back === md;
    if (!ok) fails++;
    log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `\n  IN : ${JSON.stringify(md)}\n  OUT: ${JSON.stringify(back)}\n  BLOCKS: ${JSON.stringify(strip(blocks))}`}`);
  } catch (e) { fails++; log(`FAIL ${name} ERROR ${String(e)}`); }
}

// 2. On-screen formatting → file → reopen: the block tree survives.
const styled: Record<string, any[]> = {
  underline: [{ type: "paragraph", content: [{ type: "text", text: "a ", styles: {} }, { type: "text", text: "u", styles: { underline: true } }, { type: "text", text: " b", styles: {} }] }],
  highlightColour: [{ type: "paragraph", content: [{ type: "text", text: "h", styles: { backgroundColor: "red" } }, { type: "text", text: " x ", styles: {} }, { type: "text", text: "i", styles: { backgroundColor: "yellow", bold: true } }] }],
  trailingSpace: [{ type: "paragraph", content: [{ type: "text", text: " h ", styles: { backgroundColor: "yellow" } }, { type: "text", text: "x", styles: {} }] }],
  toggle: [{ type: "toggleListItem", content: [{ type: "text", text: "T", styles: { italic: true } }], children: [{ type: "paragraph", content: [{ type: "text", text: "kid", styles: {} }] }, { type: "bulletListItem", content: [{ type: "text", text: "li", styles: {} }] }] }],
  toggleHeading: [{ type: "heading", props: { level: 3, isToggleable: true }, content: [{ type: "text", text: "TH <x>", styles: {} }], children: [{ type: "paragraph", content: [{ type: "text", text: "kid", styles: {} }] }] }],
  imgWidth: [{ type: "image", props: { url: "assets/x.png", name: "pic", previewWidth: 480.4 } }],
  imgWidthCaption: [{ type: "image", props: { url: "assets/x.png", previewWidth: 480, caption: "cap" } }],
  textColourDropped: [{ type: "paragraph", content: [{ type: "text", text: "c", styles: { textColor: "red" } }] }],
  bookmark: [{ type: "bookmark", props: { url: "https://www.rust-lang.org/", title: "The Rust language" } }],
  bookmarkNoLabel: [{ type: "bookmark", props: { url: "https://www.rust-lang.org/", title: "" } }],
  webEmbed: [{ type: "webEmbed", props: { url: "https://vimeo.com/76979871" } }],
};
for (const [name, blocks] of Object.entries(styled)) {
  try {
    const md = save(blocks);
    const again = load(md);
    const md2 = save(again);
    const ok = md === md2;
    if (!ok) fails++;
    log(`${ok ? "PASS" : "FAIL"} styled/${name}\n  MD : ${JSON.stringify(md)}${ok ? "" : `\n  MD2: ${JSON.stringify(md2)}`}\n  RE : ${JSON.stringify(strip(again))}`);
  } catch (e) { fails++; log(`FAIL styled/${name} ERROR ${String(e)}`); }
}
log(`\n${fails} failures`);
document.getElementById("out")!.textContent = out.join("\n");
