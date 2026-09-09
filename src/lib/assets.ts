// ── Assets at the load/save boundary ─────────────────────────────────────────
// On disk a note references its files by vault-relative path — the forms
// BlockNote's Markdown exporter writes, all of which GitHub and Obsidian
// render:
//
//   image            ![alt](assets/pic.png)
//   sized/captioned  <figure><img src="assets/pic.png" alt="…" width="480"><figcaption>…</figcaption></figure>
//   video            ![name](assets/clip.mp4)
//   captioned video  <figure><video src="assets/clip.mp4" data-name="…" controls></video><figcaption>…</figcaption></figure>
//   audio            <audio src="assets/take.mp3" controls></audio>   (in <figure> when captioned)
//   file             [name](assets/spec.pdf)
//
// The webview cannot load `assets/…` (no vault file scheme), so on load each
// referenced file is read as a `data:` URI and swapped in; on save the URIs
// are swapped back so the file never sees one. Both directions are pure
// functions of the text plus a map, so they can be tested without a DOM.
// The Editor owns the map and the reads.
//
// Two forms need more than a URL swap. A video written as `![name](url)` is
// only recognised as a video by its extension, which a data URI has lost, so
// it is rewritten to the `<video>` element BlockNote's own parser would have
// produced. A file link parses as a paragraph holding a link, so
// `inflateFileBlocks` turns that paragraph into a file block after parsing;
// the block exports as the same `[name](assets/…)` link, no data URI needed.

export type AssetKind = "image" | "video" | "audio" | "file";

const VIDEO_EXT = new Set(["mp4", "webm", "ogv", "mov", "mkv", "avi", "m4v"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "weba"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico", "tif", "tiff"]);

/** What a path points at, by extension; anything unknown is a plain file. */
export function assetKind(path: string): AssetKind {
  const clean = path.split(/[?#]/)[0];
  const ext = clean.includes(".") ? clean.slice(clean.lastIndexOf(".") + 1).toLowerCase() : "";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "file";
}

/** `![alt](assets/x)` — an image, or a video/audio written in the same shorthand. */
const MD_MEDIA = /!\[([^\]]*)\]\(assets\/([^)\s]+)\)/g;
/** `src="assets/x"` on the media elements BlockNote writes inside `<figure>` or on their own. */
const HTML_SRC = /(<(?:img|video|audio|embed|source)\b[^>]*\bsrc=")assets\/([^"]+)"/g;

/** The `assets/…` paths a body displays (images, video, audio) — the ones
 *  that need a display URL. File links are not listed: a file block shows a
 *  name, not the bytes. Unique, in order of first appearance. */
export function collectAssetRefs(body: string): string[] {
  const seen = new Set<string>();
  for (const [, , file] of body.matchAll(MD_MEDIA)) seen.add(`assets/${file}`);
  for (const [, , file] of body.matchAll(HTML_SRC)) seen.add(`assets/${file}`);
  return [...seen];
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Replace each `assets/X` reference with its display URL from `urls`.
 *  A path missing from the map (the file is gone from disk) is left as it
 *  is, so the reference survives the round trip untouched. */
export function assetsToDisplayUrls(body: string, urls: Map<string, string>): string {
  let result = body.replace(MD_MEDIA, (full, alt: string, file: string) => {
    const rel = `assets/${file}`;
    const url = urls.get(rel);
    if (!url) return full;
    switch (assetKind(rel)) {
      case "video": {
        const name = alt ? ` data-name="${escapeAttr(alt)}"` : "";
        return `<figure><video src="${url}"${name} controls></video></figure>`;
      }
      case "audio":
        return `<audio src="${url}" controls></audio>`;
      default:
        return `![${alt}](${url})`;
    }
  });
  result = result.replace(HTML_SRC, (full, before: string, file: string) => {
    const url = urls.get(`assets/${file}`);
    return url ? `${before}${url}"` : full;
  });
  return result;
}

/** The reverse: every display URL in `relPaths` (URL → `assets/X`) becomes
 *  its path again, wherever the exporter put it. */
export function displayUrlsToAssets(body: string, relPaths: Map<string, string>): string {
  let result = body;
  for (const [url, rel] of relPaths) {
    if (result.includes(url)) result = result.split(url).join(rel);
  }
  return result;
}

/** A paragraph that is nothing but one link to a non-media asset —
 *  `[Spec](assets/spec.pdf)`, what a file block is saved as — becomes a
 *  file block again, so it round-trips as a block rather than a link. */
export function inflateFileBlocks(blocks: any[]): any[] {
  return blocks.map((b) => {
    if (b?.type === "paragraph" && Array.isArray(b.content)) {
      const link = soleAssetLink(b.content);
      if (link) {
        return { type: "file", props: { name: link.name, url: link.url } };
      }
    }
    if (Array.isArray(b?.children) && b.children.length) {
      return { ...b, children: inflateFileBlocks(b.children) };
    }
    return b;
  });
}

function soleAssetLink(content: any[]): { name: string; url: string } | null {
  const meaningful = content.filter((n) => !(n?.type === "text" && !String(n.text ?? "").trim()));
  if (meaningful.length !== 1 || meaningful[0]?.type !== "link") return null;
  const href = String(meaningful[0].href ?? "");
  if (!href.startsWith("assets/") || assetKind(href) !== "file") return null;
  const name = (meaningful[0].content ?? [])
    .map((n: any) => (n?.type === "text" ? String(n.text ?? "") : ""))
    .join("")
    .trim();
  return { name, url: href };
}
