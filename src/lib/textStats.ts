// ── Derived reading aids: word count, reading time, outline ─────────────────
//
// All computed from the live editor document on every change and shown in
// the editor's chrome; nothing here is ever written to a note.

export interface TextStats {
  words: number;
  characters: number;
  /** Whole minutes at a comfortable 200 words per minute; 0 for an empty note. */
  readingMinutes: number;
}

const WORDS_PER_MINUTE = 200;

/** A word is any whitespace-separated run that contains a letter or digit —
 *  so "—" and "..." don't count, but "C-3PO" and "第一" do. */
export function countWords(text: string): number {
  let n = 0;
  for (const token of text.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) n++;
  }
  return n;
}

export function textStats(text: string): TextStats {
  const words = countWords(text);
  return {
    words,
    characters: Array.from(text.trim()).length,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)),
  };
}

export function formatStats(s: TextStats): string {
  const words = `${s.words.toLocaleString()} ${s.words === 1 ? "word" : "words"}`;
  if (s.words === 0) return words;
  return `${words} · ${s.characters.toLocaleString()} characters · ${s.readingMinutes} min read`;
}

// ── Outline ─────────────────────────────────────────────────────────────────

export interface OutlineEntry {
  id: string;
  level: number;
  text: string;
}

/** The minimal shape of a BlockNote block this needs — kept loose so the
 *  editor's generic block type fits without a cast at every call site. */
interface BlockLike {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BlockLike[];
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((n) => {
    if (n && typeof n === "object") {
      const o = n as { type?: string; text?: string; content?: unknown };
      if (typeof o.text === "string") return o.text;
      if (o.type === "link") return inlineText(o.content);
    }
    return "";
  }).join("");
}

/** Every heading in document order, with the block id to scroll to. Headings
 *  nested inside lists or other blocks are included — they're still headings
 *  in the Markdown. */
export function outlineOf(blocks: BlockLike[]): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const walk = (list: BlockLike[]) => {
    for (const b of list) {
      if (b.type === "heading") {
        const level = Number(b.props?.["level"] ?? 1);
        out.push({ id: b.id, level: Number.isFinite(level) ? level : 1, text: inlineText(b.content).trim() });
      }
      if (b.children?.length) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

/** Ids of every block in document order — used to find which heading the
 *  cursor sits under. */
export function blockOrder(blocks: BlockLike[]): string[] {
  const out: string[] = [];
  const walk = (list: BlockLike[]) => {
    for (const b of list) { out.push(b.id); if (b.children?.length) walk(b.children); }
  };
  walk(blocks);
  return out;
}

/** The outline entry the cursor is under: the last heading at or before the
 *  block holding the cursor, or null when the cursor is above the first one. */
export function activeHeading(outline: OutlineEntry[], order: string[], cursorBlockId: string | null): string | null {
  if (!cursorBlockId || outline.length === 0) return null;
  const at = order.indexOf(cursorBlockId);
  if (at === -1) return null;
  let active: string | null = null;
  for (const h of outline) {
    const idx = order.indexOf(h.id);
    if (idx !== -1 && idx <= at) active = h.id; else if (idx > at) break;
  }
  return active;
}
