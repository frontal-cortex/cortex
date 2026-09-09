// Run with `npm run test:lib` (node's built-in runner; no bundler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assetKind, collectAssetRefs, assetsToDisplayUrls, displayUrlsToAssets, inflateFileBlocks } from "./assets.ts";

const PIC = "data:image/png;base64,AAAA";
const CLIP = "data:video/mp4;base64,BBBB";
const TAKE = "data:audio/mpeg;base64,CCCC";
const urls = new Map([
  ["assets/pic.png", PIC],
  ["assets/clip.mp4", CLIP],
  ["assets/take.mp3", TAKE],
]);
const back = new Map([...urls].map(([rel, url]) => [url, rel]));

test("kind follows the extension, case-insensitively", () => {
  assert.equal(assetKind("assets/pic.PNG"), "image");
  assert.equal(assetKind("assets/clip.mp4"), "video");
  assert.equal(assetKind("assets/take.m4a"), "audio");
  assert.equal(assetKind("assets/spec.pdf"), "file");
  assert.equal(assetKind("assets/noext"), "file");
  assert.equal(assetKind("assets/pic.png?x=1"), "image");
});

test("collects only what is displayed, once each", () => {
  const body = [
    "![a](assets/pic.png) and again ![b](assets/pic.png)",
    '<figure><video src="assets/clip.mp4" controls></video><figcaption>c</figcaption></figure>',
    '<audio src="assets/take.mp3" controls></audio>',
    "[Spec](assets/spec.pdf)",
  ].join("\n\n");
  assert.deepEqual(collectAssetRefs(body), ["assets/pic.png", "assets/clip.mp4", "assets/take.mp3"]);
});

test("images: shorthand and sized/captioned <img> get the display URL and come back", () => {
  const body = '![alt](assets/pic.png)\n\n<figure><img src="assets/pic.png" alt="alt" width="480"><figcaption>Cap</figcaption></figure>\n';
  const shown = assetsToDisplayUrls(body, urls);
  assert.equal(shown, `![alt](${PIC})\n\n<figure><img src="${PIC}" alt="alt" width="480"><figcaption>Cap</figcaption></figure>\n`);
  assert.equal(displayUrlsToAssets(shown, back), body);
});

test("video shorthand becomes a <video> element (the data URI has no extension to go by)", () => {
  const shown = assetsToDisplayUrls("![Demo](assets/clip.mp4)\n", urls);
  assert.equal(shown, `<figure><video src="${CLIP}" data-name="Demo" controls></video></figure>\n`);
  assert.equal(assetsToDisplayUrls("![](assets/clip.mp4)", urls), `<figure><video src="${CLIP}" controls></video></figure>`);
  // What BlockNote writes back for an uncaptioned video is the shorthand again.
  assert.equal(displayUrlsToAssets(`![Demo](${CLIP})\n`, back), "![Demo](assets/clip.mp4)\n");
});

test("captioned video and audio keep their HTML, only the src changes", () => {
  const body = '<figure><video src="assets/clip.mp4" data-name="Demo" controls></video><figcaption>Cap</figcaption></figure>\n\n<audio src="assets/take.mp3" controls></audio>\n';
  const shown = assetsToDisplayUrls(body, urls);
  assert.equal(shown, `<figure><video src="${CLIP}" data-name="Demo" controls></video><figcaption>Cap</figcaption></figure>\n\n<audio src="${TAKE}" controls></audio>\n`);
  assert.equal(displayUrlsToAssets(shown, back), body);
});

test("audio written in image shorthand becomes an <audio> element", () => {
  assert.equal(assetsToDisplayUrls("![](assets/take.mp3)", urls), `<audio src="${TAKE}" controls></audio>`);
});

test("a missing asset and a file link are left exactly as written", () => {
  const body = "![gone](assets/gone.png)\n\n[Spec](assets/spec.pdf)\n\n<img src=\"assets/gone.png\">\n";
  assert.equal(assetsToDisplayUrls(body, urls), body);
});

test("a name with a quote is escaped in the data-name attribute", () => {
  assert.equal(
    assetsToDisplayUrls('![say "hi"](assets/clip.mp4)', urls),
    `<figure><video src="${CLIP}" data-name="say &quot;hi&quot;" controls></video></figure>`,
  );
});

test("reverse mapping touches every occurrence and nothing else", () => {
  const md = `![a](${PIC})\n\n<img src="${PIC}" width="200">\n\n[Spec](data:application/pdf;base64,ZZ)\n`;
  const paths = new Map([[PIC, "assets/pic.png"], ["data:application/pdf;base64,ZZ", "assets/spec.pdf"]]);
  assert.equal(displayUrlsToAssets(md, paths), '![a](assets/pic.png)\n\n<img src="assets/pic.png" width="200">\n\n[Spec](assets/spec.pdf)\n');
});

const text = (t: string) => ({ type: "text", text: t, styles: {} });
const link = (href: string, label: string) => ({ type: "link", href, content: [text(label)] });
const para = (...content: unknown[]) => ({ type: "paragraph", props: {}, content, children: [] });

test("a paragraph that is only a link to a non-media asset becomes a file block", () => {
  const blocks = inflateFileBlocks([
    para(link("assets/spec.pdf", "Spec")),
    para(text(" "), link("assets/notes.txt", "Notes"), text("  ")),
    para(text("Read "), link("assets/spec.pdf", "the spec")),
    para(link("assets/pic.png", "a picture")),
    para(link("https://example.com/x.pdf", "remote")),
  ]);
  assert.deepEqual(blocks[0], { type: "file", props: { name: "Spec", url: "assets/spec.pdf" } });
  assert.deepEqual(blocks[1], { type: "file", props: { name: "Notes", url: "assets/notes.txt" } });
  assert.equal(blocks[2].type, "paragraph", "a link inside prose stays a link");
  assert.equal(blocks[3].type, "paragraph", "a link to an image is a deliberate link");
  assert.equal(blocks[4].type, "paragraph", "only vault assets");
});

test("file blocks are found inside nested children", () => {
  const blocks = inflateFileBlocks([
    { type: "bulletListItem", props: {}, content: [text("item")], children: [para(link("assets/a.zip", "A"))] },
  ]);
  assert.deepEqual(blocks[0].children[0], { type: "file", props: { name: "A", url: "assets/a.zip" } });
});
