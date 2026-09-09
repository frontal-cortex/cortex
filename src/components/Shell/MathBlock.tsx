// ── Math: `$…$` inline and `$$…$$` block equations ────────────────────────────
// Rendered with KaTeX, bundled locally (no CDN; fonts ship with the app). On
// disk the note holds the plain GitHub / Obsidian / Pandoc syntax, so a note
// with equations still reads fine in any other tool. The nodes here exist only
// in memory; src/lib/math.ts translates them at the load/save boundary.

import { useEffect, useMemo, useRef, useState } from "react";
import { createReactBlockSpec, createReactInlineContentSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { createExtension } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { Extension, InputRule } from "@tiptap/core";
import katex from "katex";
import "katex/dist/katex.min.css";
import styles from "./MathBlock.module.css";

/** LaTeX → KaTeX HTML. Errors render in place (red source) instead of throwing. */
export function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false, output: "htmlAndMathml" });
  } catch (e) {
    return `<span class="${styles.error}">${String(e)}</span>`;
  }
}

// ── Block equation ────────────────────────────────────────────────────────────

function MathBlockView({ block, editor }: { block: any; editor: any }) {
  const latex = String(block.props.latex ?? "");
  // A fresh block (slash menu, `$$`) opens straight into the source.
  const [editing, setEditing] = useState(latex === "");
  const [draft, setDraft] = useState(latex);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(latex);
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const shown = editing ? draft : latex;
  const html = useMemo(() => (shown.trim() ? renderKatex(shown, true) : ""), [shown]);

  const commit = () => {
    if (draft !== latex) editor.updateBlock(block, { props: { latex: draft } });
    setEditing(false);
  };
  const leave = (after: boolean) => {
    commit();
    if (after) {
      const inserted = editor.insertBlocks([{ type: "paragraph" }], block, "after");
      if (inserted?.[0]) editor.setTextCursorPosition(inserted[0], "start");
    }
    editor.focus();
  };

  return (
    <div className={styles.block} contentEditable={false} data-editing={editing ? "" : undefined}>
      {html ? (
        <div className={styles.preview} onClick={() => setEditing(true)} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className={styles.empty} onClick={() => setEditing(true)}>{editing ? "Preview" : "Empty equation — click to edit"}</div>
      )}
      {editing && (
        <textarea
          ref={inputRef}
          className={styles.source}
          value={draft}
          spellCheck={false}
          placeholder={"\\int_0^1 x^2\\,dx = \\frac{1}{3}"}
          rows={Math.max(2, draft.split("\n").length)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); leave(false); }
            else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); leave(true); }
            e.stopPropagation();
          }}
        />
      )}
    </div>
  );
}

export const mathBlockSpec = createReactBlockSpec(
  {
    type: "mathBlock",
    propSchema: { latex: { default: "" } },
    content: "none",
  },
  {
    render: (props) => <MathBlockView block={props.block} editor={props.editor} />,
  },
  [
    // `$$` on an empty line opens a block equation (the Markdown syntax itself).
    createExtension({
      key: "math-block-shortcuts",
      inputRules: [{
        find: /^\$\$$/,
        replace: () => ({ type: "mathBlock", props: { latex: "" } }),
      }],
    }),
  ],
)();

export function mathSlashItem(editor: any): DefaultReactSuggestionItem {
  return {
    title: "Math",
    subtext: "Block equation, rendered with KaTeX ($$…$$)",
    aliases: ["math", "equation", "latex", "katex", "formula", "tex"],
    group: "Basic blocks",
    onItemClick: () =>
      insertOrUpdateBlockForSlashMenu(editor, { type: "mathBlock", props: { latex: "" } } as never),
  };
}

// ── Inline equation ───────────────────────────────────────────────────────────

function InlineMathView({ inlineContent, updateInlineContent }: { inlineContent: any; updateInlineContent: (u: any) => void }) {
  const latex = String(inlineContent.props.latex ?? "");
  const display = Boolean(inlineContent.props.display);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(latex);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const html = useMemo(() => (latex.trim() ? renderKatex(latex, display) : ""), [latex, display]);

  const commit = () => {
    if (draft !== latex) updateInlineContent({ type: "inlineMath", props: { latex: draft, display } });
    setEditing(false);
  };

  return (
    <span className={styles.inline} contentEditable={false}>
      {html ? (
        <span className={styles.inlinePreview} title="Click to edit" onClick={() => setEditing(true)} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className={styles.inlineEmpty} onClick={() => setEditing(true)}>math</span>
      )}
      {editing && (
        <span className={styles.inlineEditor}>
          <input
            ref={inputRef}
            className={styles.inlineInput}
            value={draft}
            spellCheck={false}
            placeholder="E = mc^2"
            size={Math.max(8, draft.length + 2)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              else if (e.key === "Escape") { e.preventDefault(); setDraft(latex); setEditing(false); }
              e.stopPropagation();
            }}
          />
        </span>
      )}
    </span>
  );
}

export const inlineMathSpec = createReactInlineContentSpec(
  {
    type: "inlineMath",
    propSchema: {
      latex: { default: "" },
      /** `$$…$$` written mid-line: display style, written back the same way. */
      display: { default: false },
    },
    content: "none",
  },
  {
    render: (props) => <InlineMathView inlineContent={props.inlineContent} updateInlineContent={props.updateInlineContent} />,
  },
);

/** Typing `$E = mc^2$` in a paragraph turns it into an inline equation, the
 *  way Obsidian does. Same rules as on disk: the opener is followed by a
 *  non-space, the closer preceded by one, so "$5 and $10" stays prose. */
export const inlineMathInputRule = Extension.create({
  name: "inlineMathInput",
  addInputRules() {
    return [
      new InputRule({
        find: /(?<![\\$\w])\$([^$\s](?:[^$]*?[^$\s])?)\$$/,
        handler: ({ state, range, match }) => {
          const type = state.schema.nodes.inlineMath;
          if (!type) return null;
          state.tr.replaceWith(range.from, range.to, type.create({ latex: match[1] }));
        },
      }),
    ];
  },
});
