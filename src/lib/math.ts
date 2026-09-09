// ── Math boundary translators ─────────────────────────────────────────────────
// On disk, math is the GitHub / Obsidian / Pandoc convention: `$…$` inline and
// `$$…$$` on its own lines for a display block. In the editor it is an
// `inlineMath` inline node and a `mathBlock` block, both rendered with KaTeX.
//
// The translation runs at the load/save boundary (same pattern as the callout
// and cortex-view blocks) but needs one extra string pass on load: BlockNote's
// Markdown parser would otherwise eat LaTeX backslash escapes (`\{`, `\\`, `\_`)
// and read `_` / `*` as emphasis. So before parsing, `extractMath` swaps every
// math span for an opaque placeholder (block math becomes a code fence, whose
// body the parser keeps verbatim), and `inflateMath` turns the placeholders
// into nodes once the blocks exist. On save, `flattenMath` writes the nodes
// back as plain text / a fence, and `restoreMath` turns the fence into `$$`.
//
// Everything here is pure and DOM-free so it can be unit-tested with node.

export interface MathSpan {
  latex: string;
  /** `$$…$$` written inline in a line (rare): rendered in display style. */
  display: boolean;
}

/** Fence language used only in memory to carry a block equation through
 *  BlockNote's Markdown parser/exporter; never written to disk. */
export const MATH_FENCE = "cortex-math";

// Private-use characters bracket the span index: no Markdown meaning, no
// escaping on either side of the round trip.
const PH_OPEN = "\uE000";
const PH_CLOSE = "\uE001";
const PLACEHOLDER_RE = /\uE000(\d+)\uE001/g;

function placeholder(i: number): string {
  return `${PH_OPEN}${i}${PH_CLOSE}`;
}

/** Text of the next fence line (``` or ~~~) if `line` opens/closes one. */
function fenceMarker(line: string): string | null {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
  return m ? m[1] : null;
}

/**
 * Markdown → Markdown: replace `$…$` spans with placeholders and `$$` blocks
 * with `cortex-math` fences. Code fences and inline code are left alone.
 */
export function extractMath(md: string): { md: string; spans: MathSpan[] } {
  const spans: MathSpan[] = [];
  const lines = md.split("\n");
  const out: string[] = [];
  let fence: string | null = null; // marker of the code fence we are inside

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fence) {
      out.push(line);
      const m = fenceMarker(line);
      if (m && m[0] === fence[0] && m.length >= fence.length && line.trim() === m) fence = null;
      continue;
    }
    const opening = fenceMarker(line);
    if (opening) {
      fence = opening;
      out.push(line);
      continue;
    }

    // Display block: a line starting with `$$` (up to 3 spaces of indent).
    // One that never closes falls through and stays ordinary text.
    if (/^ {0,3}\$\$/.test(line) && !line.trimStart().startsWith("$$$")) {
      const block = readDisplayBlock(lines, i);
      if (block) {
        out.push("```" + MATH_FENCE, block.latex, "```");
        i = block.end;
        continue;
      }
    }

    out.push(extractInline(line, spans));
  }
  return { md: out.join("\n"), spans };
}

/** Parse a `$$…$$` block starting on `lines[start]`; null if it never closes. */
function readDisplayBlock(lines: string[], start: number): { latex: string; end: number } | null {
  const first = lines[start].trim();
  // Single line: `$$ E = mc^2 $$`
  if (first.length >= 4 && first.endsWith("$$") && !first.endsWith("\\$$")) {
    const inner = first.slice(2, -2).trim();
    return inner ? { latex: inner, end: start } : null;
  }
  const body: string[] = [];
  const head = first.slice(2).trim();
  if (head) body.push(head);
  for (let j = start + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t === "$$") return { latex: body.join("\n").trim(), end: j };
    if (t.endsWith("$$") && !t.endsWith("\\$$")) {
      body.push(t.slice(0, -2).trimEnd());
      return { latex: body.join("\n").trim(), end: j };
    }
    if (fenceMarker(lines[j]) || /^\s*\$\$/.test(lines[j])) return null; // ran into something else
    body.push(lines[j]);
  }
  return null;
}

/**
 * Inline pass over one line. `$` opens math only when followed by a non-space;
 * the closing `$` must follow a non-space and not precede a digit (so
 * "costs $5 and $10" stays prose). `$$…$$` on one line mid-paragraph is a
 * display span. Backtick code spans are skipped.
 */
function extractInline(line: string, spans: MathSpan[]): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) {
      out += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "`") {
      // Skip a code span: a run of N backticks up to the next run of N.
      let n = 0;
      while (line[i + n] === "`") n++;
      const run = "`".repeat(n);
      const close = line.indexOf(run, i + n);
      if (close === -1) {
        out += run;
        i += n;
      } else {
        out += line.slice(i, close + n);
        i = close + n;
      }
      continue;
    }
    if (ch === "$") {
      const display = line[i + 1] === "$";
      const open = display ? 2 : 1;
      const end = findClosingDollar(line, i + open, display);
      if (end !== -1) {
        const latex = line.slice(i + open, end);
        spans.push({ latex: display ? latex.trim() : latex, display });
        out += placeholder(spans.length - 1);
        i = end + open;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/** Index of the closing `$` (or first of `$$`) for a span opened at `from`; -1 if none. */
function findClosingDollar(line: string, from: number, display: boolean): number {
  const first = line[from];
  if (first === undefined || /\s/.test(first) || (!display && first === "$")) return -1;
  for (let j = from; j < line.length; j++) {
    const c = line[j];
    if (c === "\\") { j++; continue; }
    if (c !== "$") continue;
    if (display) {
      if (line[j + 1] !== "$") continue;
      if (j === from) return -1;
      return j;
    }
    if (j === from) return -1;
    if (/\s/.test(line[j - 1])) return -1; // "$5 and $" — closing after a space is not math
    if (/\d/.test(line[j + 1] ?? "")) return -1;
    return j;
  }
  return -1;
}

// ── Blocks ──────────────────────────────────────────────────────────────────

type AnyBlock = Record<string, any>;
type InlineFn = (content: any[]) => any[];

/** Apply `fn` to every inline-content array of a block: its own content
 *  (paragraphs, headings, list items, callouts), table cells, and link text. */
function mapInlineContent(b: AnyBlock, fn: InlineFn): AnyBlock {
  const links = (content: any[]): any[] =>
    fn(content).map((item) =>
      item?.type === "link" && Array.isArray(item.content) ? { ...item, content: fn(item.content) } : item);
  if (Array.isArray(b?.content)) return { ...b, content: links(b.content) };
  if (b?.content?.type === "tableContent" && Array.isArray(b.content.rows)) {
    const rows = b.content.rows.map((row: any) => ({
      ...row,
      cells: (row.cells ?? []).map((cell: any) =>
        Array.isArray(cell) ? links(cell)
          : Array.isArray(cell?.content) ? { ...cell, content: links(cell.content) }
            : cell),
    }));
    return { ...b, content: { ...b.content, rows } };
  }
  return b;
}

/** Map every block in a tree (children included) through `fn`. */
function walkBlocks(blocks: AnyBlock[], fn: (b: AnyBlock) => AnyBlock): AnyBlock[] {
  return blocks.map((b) => {
    const next = fn(b);
    return Array.isArray(next?.children) && next.children.length
      ? { ...next, children: walkBlocks(next.children, fn) }
      : next;
  });
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : "")).join("");
}

/** Blocks (parsed from `extractMath` output) → blocks with math nodes. */
export function inflateMath(blocks: AnyBlock[], spans: MathSpan[]): AnyBlock[] {
  const expand: InlineFn = (content) => {
    const out: any[] = [];
    for (const item of content) {
      if (item?.type !== "text" || typeof item.text !== "string" || item.styles?.code) {
        out.push(item);
        continue;
      }
      const text: string = item.text;
      const styles = item.styles ?? {};
      let last = 0;
      for (const m of text.matchAll(PLACEHOLDER_RE)) {
        const span = spans[Number(m[1])];
        if (!span) continue;
        if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index), styles });
        out.push({ type: "inlineMath", props: { latex: span.latex, display: span.display } });
        last = m.index + m[0].length;
      }
      if (last < text.length) out.push({ type: "text", text: text.slice(last), styles });
    }
    return out;
  };
  return walkBlocks(blocks, (b) => {
    if (b?.type === "codeBlock" && b?.props?.language === MATH_FENCE) {
      return { type: "mathBlock", props: { latex: inlineText(b.content) } };
    }
    return mapInlineContent(b, expand);
  });
}

/** Blocks → blocks: math nodes back to plain text / a `cortex-math` fence. */
export function flattenMath(blocks: AnyBlock[]): AnyBlock[] {
  const collapse: InlineFn = (content) =>
    content.map((item) => {
      if (item?.type !== "inlineMath") return item;
      const latex = String(item.props?.latex ?? "");
      return { type: "text", text: item.props?.display ? `$$${latex}$$` : `$${latex}$`, styles: {} };
    });
  return walkBlocks(blocks, (b) => {
    if (b?.type === "mathBlock") {
      return {
        type: "codeBlock",
        props: { language: MATH_FENCE },
        content: [{ type: "text", text: String(b.props?.latex ?? ""), styles: {} }],
      };
    }
    return mapInlineContent(b, collapse);
  });
}

/** Markdown (from the exporter) → Markdown: `cortex-math` fences back to `$$`. */
export function restoreMath(md: string): string {
  return md.replace(/(`{3,})cortex-math\n([\s\S]*?)\1/g, (_m, _fence, body: string) => {
    const latex = body.endsWith("\n") ? body.slice(0, -1) : body;
    return `$$\n${latex}\n$$`;
  });
}
