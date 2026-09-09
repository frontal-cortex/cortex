// ── Bookmark and web-embed blocks: the file boundary ─────────────────────────
// Both blocks exist only in memory; on disk they are ordinary Markdown that
// GitHub, Obsidian and a text editor all show as a link:
//
//   bookmark    [Label](https://…)     alone in a paragraph
//   web embed   <https://…>            alone in a paragraph (a CommonMark autolink)
//
// A paragraph that is exactly one web link becomes a bookmark card on load;
// the card's title, description and favicon come from a preview the app
// fetches once and caches in `.brain/previews/` — never from the file, and
// never written into it. The autolink form marks an embed: a bare URL a
// person pastes stays plain text, so nothing turns into a frame unless it
// was asked to. The `<iframe>` form was rejected because GitHub strips it
// to nothing, while an autolink degrades to a clickable link everywhere.
//
// Translation happens at the load/save boundary like the other Cortex
// blocks (callouts, embeds, math): `extractEmbedLines` runs on the Markdown
// before BlockNote parses it (so a `_` in a URL is never read as emphasis),
// `inflateWebBlocks` on the parsed blocks, `flattenWebBlocks` before export.

/** Private-use character standing in for an embed's link text between
 *  `extractEmbedLines` and `inflateWebBlocks`. */
export const EMBED_MARK = "\uE002";

const EMBED_LINE_RE = /^ {0,3}<(https?:\/\/[^\s<>]+)>\s*$/;

/** Text of the fence line (``` or ~~~) if `line` opens or closes one. */
function fenceMarker(line: string): string | null {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
  return m ? m[1] : null;
}

/** Markdown → Markdown: an autolink alone on a line becomes a link the
 *  parser reads verbatim (`[EMBED_MARK](url)`). Code fences are left alone. */
export function extractEmbedLines(md: string): string {
  let fence: string | null = null;
  return md.split("\n").map((line) => {
    if (fence) {
      const m = fenceMarker(line);
      if (m && m[0] === fence[0] && m.length >= fence.length && line.trim() === m) fence = null;
      return line;
    }
    const opening = fenceMarker(line);
    if (opening) { fence = opening; return line; }
    const m = line.match(EMBED_LINE_RE);
    return m ? `[${EMBED_MARK}](${m[1]})` : line;
  }).join("\n");
}

export function isWebUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s.trim());
}

/** The label a bookmark gets when the user has not written one: the URL
 *  without its scheme, so the file reads `[rust-lang.org](https://rust-lang.org/)`.
 *  (The exporter writes a link whose text equals its URL as a bare URL, which
 *  would stop being a bookmark on the next open — the label must differ.) */
export function bookmarkLabel(url: string): string {
  const stripped = url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  return stripped || url.trim();
}

type Inline = any;

function linkText(link: Inline): string {
  return (Array.isArray(link.content) ? link.content : [])
    .map((c: Inline) => (c?.type === "text" ? String(c.text ?? "") : ""))
    .join("");
}

/** The one web link a paragraph consists of (whitespace aside), or null. */
export function soleWebLink(content: unknown): { href: string; text: string } | null {
  if (!Array.isArray(content)) return null;
  const nodes = content.filter((n) => !(n?.type === "text" && String(n.text ?? "").trim() === ""));
  if (nodes.length !== 1 || nodes[0]?.type !== "link") return null;
  // BlockNote's parser keeps the backslash escapes a destination needs for
  // `(` and `)` (`\(`), and its exporter adds them again on save; the block
  // holds the real URL, so they are dropped here and re-added on the way out.
  const href = String(nodes[0].href ?? "").replace(/\\([\\()])/g, "$1");
  if (!isWebUrl(href)) return null;
  return { href: href.trim(), text: linkText(nodes[0]).trim() };
}

/** Markdown → blocks: a paragraph that is exactly one web link becomes a
 *  bookmark; the embed mark from `extractEmbedLines` becomes a web embed. */
export function inflateWebBlocks(blocks: any[]): any[] {
  return blocks.map((b) => {
    const children = Array.isArray(b?.children) && b.children.length ? inflateWebBlocks(b.children) : b?.children;
    if (b?.type === "paragraph") {
      const link = soleWebLink(b.content);
      if (link) {
        const block = link.text === EMBED_MARK
          ? { type: "webEmbed", props: { url: link.href } }
          : { type: "bookmark", props: { url: link.href, title: link.text === bookmarkLabel(link.href) ? "" : link.text } };
        return Array.isArray(children) && children.length ? { ...block, children } : block;
      }
    }
    return children === b?.children ? b : { ...b, children };
  });
}

function paragraph(content: Inline[], children: unknown): any {
  const p: any = { type: "paragraph", content };
  if (Array.isArray(children) && children.length) p.children = children;
  return p;
}

/** Blocks → markdown: a bookmark back to `[Label](url)`, an embed back to
 *  `<url>`. One with no URL yet (just inserted) leaves nothing behind. */
export function flattenWebBlocks(blocks: any[]): any[] {
  return blocks.map((b) => {
    const children = Array.isArray(b?.children) && b.children.length ? flattenWebBlocks(b.children) : b?.children;
    if (b?.type === "bookmark") {
      const url = String(b.props?.url ?? "").trim();
      if (!url) return paragraph([], children);
      let title = String(b.props?.title ?? "").trim();
      if (!title || title === url) title = bookmarkLabel(url);
      return paragraph([{ type: "link", href: url, content: [{ type: "text", text: title, styles: {} }] }], children);
    }
    if (b?.type === "webEmbed") {
      const url = String(b.props?.url ?? "").trim();
      return paragraph(url ? [{ type: "text", text: `<${url}>`, styles: {} }] : [], children);
    }
    return children === b?.children ? b : { ...b, children };
  });
}
