// ── Callout block ─────────────────────────────────────────────────────────────
// A Notion-style callout: an emoji + a colored box of editable rich text. On
// disk it is an Obsidian-style admonition blockquote, e.g.
//
//     > [!tip] Use keyboard shortcuts
//
// so it stays human-readable and round-trips through standard Markdown. The
// custom block exists only in memory; we translate callout <-> the built-in
// `quote` block at the load/save boundary (same pattern as cortex-view / embed).

import { createReactBlockSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import styles from "./CalloutBlock.module.css";

interface CalloutKind {
  type: string;
  icon: string;
  color: string; // tag palette name (see tokens.css)
}

const CALLOUT_KINDS: CalloutKind[] = [
  { type: "note", icon: "📝", color: "blue" },
  { type: "tip", icon: "💡", color: "green" },
  { type: "info", icon: "ℹ️", color: "blue" },
  { type: "warning", icon: "⚠️", color: "yellow" },
  { type: "danger", icon: "🔥", color: "red" },
];

const KIND_BY_TYPE = new Map(CALLOUT_KINDS.map((k) => [k.type, k]));
export const CALLOUT_TYPES = CALLOUT_KINDS.map((k) => k.type);

function kindFor(type: string): CalloutKind {
  return KIND_BY_TYPE.get(type) ?? CALLOUT_KINDS[0];
}

function Callout({ block, editor, contentRef }: { block: any; editor: any; contentRef: any }) {
  const type = String(block.props.calloutType ?? "note");
  const kind = kindFor(type);

  // Click the icon to cycle through the callout kinds (keeps content intact).
  const cycle = () => {
    const idx = CALLOUT_KINDS.findIndex((k) => k.type === type);
    const next = CALLOUT_KINDS[(idx + 1) % CALLOUT_KINDS.length];
    editor.updateBlock(block, { props: { calloutType: next.type } });
  };

  return (
    <div className={styles.callout} style={{ background: `var(--tag-${kind.color}-bg)` }}>
      <button
        className={styles.icon}
        contentEditable={false}
        onClick={cycle}
        title="Change callout type"
      >
        {kind.icon}
      </button>
      <div className={styles.body} ref={contentRef} />
    </div>
  );
}

export const calloutSpec = createReactBlockSpec(
  {
    type: "callout",
    propSchema: { calloutType: { default: "note" } },
    content: "inline",
  },
  {
    render: (props) => <Callout block={props.block} editor={props.editor} contentRef={props.contentRef} />,
  },
)();

export function calloutSlashItem(editor: any): DefaultReactSuggestionItem {
  return {
    title: "Callout",
    subtext: "Highlighted box for a note, tip, or warning",
    aliases: ["callout", "admonition", "note", "tip", "warning", "info"],
    group: "Basic blocks",
    onItemClick: () =>
      insertOrUpdateBlockForSlashMenu(editor, { type: "callout", props: { calloutType: "note" } } as never),
  };
}

// ── Boundary translation ──────────────────────────────────────────────────────

const CALLOUT_RE = /^\[!(\w+)\]\s?/;

/** Markdown → blocks: a `quote` whose text starts with `[!type]` is a callout. */
export function inflateCallouts(blocks: any[]): any[] {
  return blocks.map((b) => {
    if (b?.type === "quote" && Array.isArray(b.content) && b.content.length) {
      const first = b.content[0];
      if (first?.type === "text" && typeof first.text === "string") {
        const m = first.text.match(CALLOUT_RE);
        if (m) {
          const type = CALLOUT_TYPES.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : "note";
          const stripped = { ...first, text: first.text.slice(m[0].length) };
          const content = stripped.text ? [stripped, ...b.content.slice(1)] : b.content.slice(1);
          return { type: "callout", props: { calloutType: type }, content };
        }
      }
    }
    if (Array.isArray(b?.children) && b.children.length) {
      return { ...b, children: inflateCallouts(b.children) };
    }
    return b;
  });
}

/** Blocks → markdown: collapse a callout back to a `> [!type] …` blockquote. */
export function flattenCallouts(blocks: any[]): any[] {
  return blocks.map((b) => {
    if (b?.type === "callout") {
      const type = String(b.props?.calloutType ?? "note");
      const content = Array.isArray(b.content) ? b.content : [];
      return { type: "quote", content: [{ type: "text", text: `[!${type}] `, styles: {} }, ...content] };
    }
    if (Array.isArray(b?.children) && b.children.length) {
      return { ...b, children: flattenCallouts(b.children) };
    }
    return b;
  });
}
