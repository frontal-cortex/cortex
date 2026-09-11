// ── Block alignment on disk ───────────────────────────────────────────────────
// Markdown has no alignment and BlockNote's exporter drops it, so an aligned
// block is written as literal HTML carrying both spellings:
//
//   <p align="center" style="text-align: center">…</p>
//
// `align` is the half GitHub renders (its sanitiser strips `style`); `style` is
// the half BlockNote's parser reads back (it ignores `align`). Obsidian honours
// either, and a plain-text reader sees the words.
//
// Text blocks round-trip on their own once written this way. An image does not:
// BlockNote's image parse rule reads url, width and caption and nothing else,
// so an image's alignment is collected from the markdown before it is parsed
// and put back on the blocks afterwards — the same shape as the math
// translators in `math.ts`.

export type Align = "center" | "right" | "justify";

const ALIGNS = new Set<string>(["center", "right", "justify"]);

/** A block's alignment, or "" when it is the default (left). */
export function alignOf(props: unknown): Align | "" {
  const a = (props as { textAlignment?: unknown } | null | undefined)?.textAlignment;
  return typeof a === "string" && ALIGNS.has(a) ? (a as Align) : "";
}

/** An image sits on its own line, so only the two alignments that move it are
 *  worth writing; `justify` reads as left for a single element. */
export function imageAlignOf(props: unknown): Align | "" {
  const a = alignOf(props);
  return a === "justify" ? "" : a;
}

/** `<p align="center" style="text-align: center">…</p>` */
export function alignedHtml(tag: string, align: Align, inner: string): string {
  return `<${tag} align="${align}" style="text-align: ${align}">${inner}</${tag}>`;
}

// The wrapper this module writes, around a bare <img> or a captioned <figure>.
// Both spellings are accepted on the way in, so a file hand-written with only
// one of them still opens aligned.
const WRAPPED_IMAGE =
  /<(?:p|div)\b[^>]*?(?:align="(center|right|justify)"|text-align:\s*(center|right|justify))[^>]*>\s*(?:<figure\b[^>]*>\s*)?<img\b[^>]*?\bsrc="([^"]*)"/gi;

/** The alignments to restore on a document's images, queued per URL so two
 *  copies of one image keep their own. Read from the markdown the parser is
 *  about to see, so the URLs match the blocks it returns. */
export function imageAlignments(md: string): Map<string, Align[]> {
  const out = new Map<string, Align[]>();
  for (const m of md.matchAll(WRAPPED_IMAGE)) {
    const align = (m[1] ?? m[2]) as Align | undefined;
    const src = m[3];
    if (!align || !src) continue;
    const queued = out.get(src);
    if (queued) queued.push(align);
    else out.set(src, [align]);
  }
  return out;
}

/** Put those alignments back on the image blocks, in document order. */
export function applyImageAlignments(blocks: any[], queues: Map<string, Align[]>): any[] {
  if (queues.size === 0) return blocks;
  const walk = (bs: any[]): any[] =>
    bs.map((b) => {
      const children = Array.isArray(b?.children) && b.children.length ? walk(b.children) : b?.children;
      if (b?.type === "image") {
        const align = queues.get(String(b.props?.url ?? ""))?.shift();
        if (align) return { ...b, props: { ...b.props, textAlignment: align }, children };
      }
      return children === b?.children ? b : { ...b, children };
    });
  return walk(blocks);
}
