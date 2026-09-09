// ── Formatting that has no GFM form ───────────────────────────────────────────
// BlockNote's Markdown exporter drops what GFM cannot say: a toggle flattens
// to a plain bullet or heading, underline and highlight spans are stripped,
// and a resized image loses its width. Each gets a degradable on-disk form
// here, translated at the load/save boundary (same pattern as CalloutBlock):
//
//   toggle list item   <details><summary>…</summary>          … </details>
//   toggle heading     <details><summary><h2>…</h2></summary> … </details>
//   underline          <u>…</u>
//   highlight          ==…==      (Obsidian's syntax; the colour collapses to yellow)
//   image width        <img src="…" alt="…" width="480">   (inside <figure> when captioned)
//
// GitHub and Obsidian render every one of these. The HTML forms need no
// parse-side work: BlockNote's Markdown parser passes inline and block HTML
// through, and its HTML parser already understands <details>, <u> and
// <img width>. Only ==highlight== is inflated here. Text colour has no
// Markdown form and is a non-goal (docs/parity/notion-parity.md §2).

const HIGHLIGHT_COLOR = "yellow";

type Inline = any;

function plain(text: string, styles: Record<string, unknown> = {}): Inline {
  return { type: "text", text, styles };
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

// ── Blocks → markdown ─────────────────────────────────────────────────────────

// The styles this module serialises itself; everything else (bold, italic,
// strike, code, links) is the exporter's job and must not leak onto markers.
const OWN_STYLES = ["underline", "backgroundColor"];

function ownStyles(n: Inline): Record<string, unknown> {
  const src = n?.type === "link" ? n.content?.[0]?.styles : n?.styles;
  return Object.fromEntries(Object.entries(src ?? {}).filter(([k]) => OWN_STYLES.includes(k)));
}

/** Wrap each run of nodes carrying `style` in literal `open`/`close` text
 *  nodes and strip the style from the run. A link counts as one node: it
 *  joins a run when all its text does, so the markers land outside it. The
 *  markers inherit the run's other own styles, so a later pass for an outer
 *  style sees one unbroken run. Leading and trailing whitespace stays outside
 *  the markers (`==x== `, not `==x ==`). */
function wrapRuns(content: Inline[], style: string, open: string, close: string): Inline[] {
  const out: Inline[] = [];
  let inRun = false;
  const hasText = (n: Inline) => n?.type === "text" && n.styles?.[style] && n.styles[style] !== "default";
  const has = (n: Inline): boolean =>
    n?.type === "link" ? Array.isArray(n.content) && n.content.some(hasText) && n.content.every(hasText) : hasText(n);
  const strip = (n: Inline): Inline => {
    if (n.type === "link") return { ...n, content: n.content.map(strip) };
    const styles = { ...n.styles };
    delete styles[style];
    return { ...n, styles };
  };
  const closeRun = () => {
    const last = out[out.length - 1];
    const ws = last?.type === "text" ? last.text.match(/\s+$/)?.[0] : undefined;
    if (ws) {
      out.pop();
      if (ws.length < last.text.length) out.push({ ...last, text: last.text.slice(0, -ws.length) });
      out.push(plain(close, ownStyles(last)), plain(ws, ownStyles(last)));
    } else {
      out.push(plain(close, ownStyles(last)));
    }
    inRun = false;
  };
  for (const node of content) {
    if (!has(node)) {
      if (inRun) closeRun();
      // A partly styled link: the markers go inside it.
      out.push(node?.type === "link" && Array.isArray(node.content)
        ? { ...node, content: wrapRuns(node.content, style, open, close) }
        : node);
      continue;
    }
    let n = strip(node);
    if (!inRun) {
      const ws = n.type === "text" ? n.text.match(/^\s+/)?.[0] : undefined;
      if (ws) {
        out.push(plain(ws, ownStyles(n)));
        if (ws.length === n.text.length) continue; // whitespace only: nothing to wrap yet
        n = { ...n, text: n.text.slice(ws.length) };
      }
      out.push(plain(open, ownStyles(n)));
      inRun = true;
    }
    out.push(n);
  }
  if (inRun) closeRun();
  return out;
}

/** Inline content → what BlockNote's exporter should emit for it verbatim. */
function flattenInline(content: Inline[]): Inline[] {
  return wrapRuns(wrapRuns(content, "underline", "<u>", "</u>"), "backgroundColor", "==", "==");
}

/** Inline content → HTML, for a toggle's <summary>. Markdown inside a raw HTML
 *  block is not parsed (by BlockNote or GitHub), so styles go out as tags. */
function inlineToHtml(content: Inline[]): string {
  return wrapRuns(content, "backgroundColor", "==", "==").map((n: Inline): string => {
    if (n?.type === "link") return `<a href="${escapeAttr(String(n.href ?? ""))}">${inlineToHtml(n.content ?? [])}</a>`;
    if (n?.type !== "text") return "";
    let html = escapeText(String(n.text ?? ""));
    const s = n.styles ?? {};
    if (s.code) html = `<code>${html}</code>`;
    if (s.underline) html = `<u>${html}</u>`;
    if (s.strike) html = `<s>${html}</s>`;
    if (s.italic) html = `<em>${html}</em>`;
    if (s.bold) html = `<strong>${html}</strong>`;
    return html;
  }).join("");
}

function imgHtml(props: Record<string, any>): string {
  const alt = props.name ? ` alt="${escapeAttr(String(props.name))}"` : "";
  return `<img src="${escapeAttr(String(props.url ?? ""))}"${alt} width="${Math.round(Number(props.previewWidth))}">`;
}

function mapCells(content: any, f: (c: Inline[]) => Inline[]): any {
  if (!content || content.type !== "tableContent" || !Array.isArray(content.rows)) return content;
  return {
    ...content,
    rows: content.rows.map((row: any) => ({
      ...row,
      cells: (row.cells ?? []).map((cell: any) =>
        cell?.type === "tableCell" ? { ...cell, content: f(cell.content ?? []) } : f(cell ?? [])),
    })),
  };
}

/** Blocks → markdown: literal HTML / `==` markers for the forms GFM lacks. */
export function flattenRichFormats(blocks: any[]): any[] {
  const out: any[] = [];
  for (const b of blocks) {
    const children = Array.isArray(b?.children) && b.children.length ? flattenRichFormats(b.children) : b?.children;
    const isToggle = b?.type === "toggleListItem" || (b?.type === "heading" && b.props?.isToggleable);
    if (isToggle) {
      // A toggle becomes three siblings: the <details> opener, its children,
      // the closer — each a normal block, so the exporter writes them verbatim.
      const inner = inlineToHtml(Array.isArray(b.content) ? b.content : []);
      const level = b.type === "heading" ? Number(b.props?.level ?? 1) : 0;
      const summary = level ? `<h${level}>${inner}</h${level}>` : inner;
      out.push({ type: "paragraph", content: [plain(`<details><summary>${summary}</summary>`)] });
      if (Array.isArray(children)) out.push(...children);
      out.push({ type: "paragraph", content: [plain("</details>")] });
      continue;
    }
    if (b?.type === "image" && b.props?.previewWidth) {
      const img = imgHtml(b.props);
      const caption = String(b.props.caption ?? "");
      const html = caption ? `<figure>${img}<figcaption>${escapeText(caption)}</figcaption></figure>` : img;
      out.push({ type: "paragraph", content: [plain(html)], children });
      continue;
    }
    const content = Array.isArray(b?.content) ? flattenInline(b.content)
      : b?.type === "table" ? mapCells(b.content, flattenInline)
      : b?.content;
    out.push({ ...b, content, children });
  }
  return out;
}

// ── Markdown → blocks ─────────────────────────────────────────────────────────

// `==text==`: no leading/trailing space inside the markers, so `a == b` is
// left alone. May span styled runs (`==**bold** rest==`).
const HIGHLIGHT_RE = /==(\S(?:[\s\S]*?\S)?)==/g;

function textLength(n: Inline): number {
  if (n?.type === "text") return String(n.text ?? "").length;
  if (n?.type === "link") return (n.content ?? []).reduce((sum: number, c: Inline) => sum + textLength(c), 0);
  return 0;
}

function withHighlight(n: Inline): Inline {
  if (n?.type === "link") return { ...n, content: (n.content ?? []).map(withHighlight) };
  if (n?.type !== "text") return n;
  return { ...n, styles: { ...(n.styles ?? {}), backgroundColor: HIGHLIGHT_COLOR } };
}

/** Apply the highlight style to `==…==` spans and drop the markers. Markers
 *  are matched over the concatenated text of the run, with code and link text
 *  masked so their `=` signs never pair with markers outside them. */
function inflateHighlights(content: Inline[]): Inline[] {
  const nodes = content.map((n) =>
    n?.type === "link" && Array.isArray(n.content) ? { ...n, content: inflateHighlights(n.content) } : n);
  const masked = nodes.map((n) =>
    n?.type === "text" && !n.styles?.code ? String(n.text ?? "") : "".repeat(textLength(n))).join("");
  const ranges = [...masked.matchAll(HIGHLIGHT_RE)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  if (!ranges.length) return nodes;

  // Where an absolute character offset falls: inside a marker, inside a
  // highlighted span, or in plain text.
  const classify = (pos: number): "marker" | "inner" | "plain" => {
    for (const r of ranges) {
      if (pos < r.start || pos >= r.end) continue;
      return pos < r.start + 2 || pos >= r.end - 2 ? "marker" : "inner";
    }
    return "plain";
  };

  const out: Inline[] = [];
  let offset = 0;
  for (const n of nodes) {
    const len = textLength(n);
    if (n?.type !== "text") {
      // A link or other node: highlighted when any of it lies inside a span.
      let inner = false;
      for (let p = offset; p < offset + len && !inner; p++) inner = classify(p) === "inner";
      out.push(inner ? withHighlight(n) : n);
      offset += len;
      continue;
    }
    const text = String(n.text ?? "");
    let start = 0;
    while (start < len) {
      const kind = classify(offset + start);
      let end = start + 1;
      while (end < len && classify(offset + end) === kind) end++;
      const piece = text.slice(start, end);
      if (kind === "inner") out.push(withHighlight({ ...n, text: piece }));
      else if (kind === "plain") out.push({ ...n, text: piece });
      start = end;
    }
    offset += len;
  }
  return out;
}

/** Markdown → blocks: turn `==highlight==` markers into the highlight style.
 *  Toggles, underline and image width need nothing: the parser already reads
 *  their HTML forms. */
export function inflateRichFormats(blocks: any[]): any[] {
  return blocks.map((b) => {
    const content = Array.isArray(b?.content) ? inflateHighlights(b.content)
      : b?.type === "table" ? mapCells(b.content, inflateHighlights)
      : b?.content;
    const children = Array.isArray(b?.children) && b.children.length ? inflateRichFormats(b.children) : b?.children;
    return content === b?.content && children === b?.children ? b : { ...b, content, children };
  });
}
