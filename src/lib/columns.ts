// ── Columns ──────────────────────────────────────────────────────────────────
// A side-by-side layout, written as directive fences so the file still reads
// top to bottom anywhere else:
//
//     ::: columns 1 2 1
//     left column blocks
//     :::
//     middle column, twice as wide
//     :::
//     right column
//     ::: end
//
// GitHub shows the `:::` lines as text and the content in order — the honest
// fallback. In the editor a `columnList` block holds `column` blocks, whose
// children are the content; the translation happens here, at the load/save
// boundary, on the block tree (pure, tested with node --test).

const OPEN_RE = /^:::\s*columns((?:\s+\d+(?:\.\d+)?)*)\s*$/i;
const SEP_RE = /^:::\s*$/;
const END_RE = /^:::\s*end\s*$/i;

function textOf(block: any): string | null {
  if (block?.type !== "paragraph" || !Array.isArray(block.content)) return null;
  if (block.content.some((c: any) => c?.type !== "text")) return null;
  return block.content.map((c: any) => String(c.text ?? "")).join("").trim();
}

function paragraph(text: string): any {
  return { type: "paragraph", content: [{ type: "text", text, styles: {} }] };
}

function emptyParagraph(): any {
  return { type: "paragraph", content: [] };
}

/** Column widths from the fence's ratio list; `n` columns of `1` when none. */
export function parseRatios(s: string, n: number): number[] {
  const r = s.trim().split(/\s+/).filter(Boolean).map(Number).filter((x) => x > 0);
  if (r.length === n) return r;
  return Array.from({ length: n }, (_, i) => r[i] ?? 1);
}

/** Markdown → blocks: fold `::: columns … ::: end` runs into a columnList. Only
 *  at the top level; a fence with no `::: end` closes at the document's end. */
export function inflateColumns(blocks: any[]): any[] {
  const out: any[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const t = textOf(blocks[i]);
    const m = t !== null ? t.match(OPEN_RE) : null;
    if (!m) { out.push(blocks[i]); continue; }
    const cols: any[][] = [[]];
    let j = i + 1;
    for (; j < blocks.length; j++) {
      const tt = textOf(blocks[j]);
      if (tt !== null && END_RE.test(tt)) break;
      if (tt !== null && SEP_RE.test(tt)) { cols.push([]); continue; }
      cols[cols.length - 1].push(blocks[j]);
    }
    const ratios = parseRatios(m[1] ?? "", cols.length);
    out.push({
      type: "columnList",
      props: { ratios: ratios.join(" ") },
      children: cols.map((children, k) => ({
        type: "column",
        props: { width: String(ratios[k]) },
        children: children.length ? children : [emptyParagraph()],
      })),
    });
    i = j; // skip past `::: end` (or the end of the document)
  }
  return out;
}

/** Blocks → markdown: unfold a columnList into the fence lines and its columns'
 *  blocks, in reading order. Runs first on save so the other flatteners see
 *  the inner blocks at the top level. */
export function flattenColumns(blocks: any[]): any[] {
  return blocks.flatMap((b) => {
    if (b?.type === "columnList") {
      const columns = (Array.isArray(b.children) ? b.children : []).filter((c: any) => c?.type === "column");
      const ratios = columns.map((c: any) => String(c.props?.width ?? "1"));
      const allOne = ratios.every((r: string) => r === "1");
      const out: any[] = [paragraph(allOne ? "::: columns" : `::: columns ${ratios.join(" ")}`)];
      columns.forEach((c: any, k: number) => {
        if (k > 0) out.push(paragraph(":::"));
        const inner = flattenColumns(Array.isArray(c.children) ? c.children : []);
        // An empty column is one empty paragraph in the editor; on disk it is nothing.
        out.push(...inner.filter((x: any, idx: number) => !(inner.length === 1 && idx === 0 && textOf(x) === "")));
      });
      out.push(paragraph("::: end"));
      return out;
    }
    if (b?.type === "column") {
      // A column that lost its list (dragged out) is just its content.
      return flattenColumns(Array.isArray(b.children) ? b.children : []);
    }
    if (Array.isArray(b?.children) && b.children.length) {
      return [{ ...b, children: flattenColumns(b.children) }];
    }
    return [b];
  });
}

/** A fresh column layout for the slash menu: `n` equal columns, each with an
 *  empty paragraph to type into. */
export function newColumnList(n: number): any {
  return {
    type: "columnList",
    props: { ratios: Array(n).fill("1").join(" ") },
    children: Array.from({ length: n }, () => ({ type: "column", props: { width: "1" }, children: [emptyParagraph()] })),
  };
}
