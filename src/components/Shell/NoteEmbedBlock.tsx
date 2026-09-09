// ── Transclusion block: `![[note]]` / `![[note#section]]` ──────────────────────
// Renders another note's content (or one section) inline and read-only — a live
// view, re-read from disk each mount, so edits to the source show up here. On
// disk it is ALWAYS the plain text `![[target]]` (human-readable, git-diffable);
// the custom block exists only in memory, translated at the load/save boundary
// exactly like the cortex-view block.

import { useState, useEffect, useCallback } from "react";
import { createReactBlockSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { commands, NoteRef } from "../../lib/commands";
import { parseWikiLink } from "../../lib/wikiLink";
import { OpenIcon } from "./icons";
import { MiniMarkdown } from "./MiniMarkdown";
import styles from "./NoteEmbedBlock.module.css";

/** Ask the shell to navigate to a wiki target (reuses Shell's resolver). */
function navigateTo(target: string) {
  window.dispatchEvent(new CustomEvent("cortex:navigate", { detail: { target } }));
}

// ── The block ─────────────────────────────────────────────────────────────────

function NoteEmbed({ block, editor }: { block: any; editor: any }) {
  const target = String(block.props.target ?? "");
  const [ref, setRef] = useState<NoteRef | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(!target);
  const [draft, setDraft] = useState(target);

  const load = useCallback(() => {
    if (!target) { setRef(null); return; }
    setLoading(true);
    commands.resolveRef(target)
      .then(setRef)
      .catch(() => setRef(null))
      .finally(() => setLoading(false));
  }, [target]);

  useEffect(() => { load(); }, [load]);

  const save = () => {
    editor.updateBlock(block, { props: { target: draft.trim() } });
    setEditing(false);
  };

  const section = parseWikiLink(target).section;
  const displayTarget = target || "Untitled";

  return (
    <div className={styles.embed} contentEditable={false}>
      <div className={styles.bar}>
        <span className={styles.badge}>Embed</span>
        {ref?.found ? (
          <button className={styles.titleLink} onClick={() => navigateTo(target)} title="Open source note">
            {ref.title}{section ? ` › ${section}` : ""}
            <OpenIcon size={12} />
          </button>
        ) : (
          <span className={styles.meta}>{displayTarget}</span>
        )}
        <button className={styles.editBtn} onClick={() => { setDraft(target); setEditing((e) => !e); }}>
          {editing ? "Close" : "Change"}
        </button>
      </div>

      {editing && (
        <div className={styles.editor}>
          <input
            className={styles.input}
            autoFocus
            value={draft}
            placeholder="Note title or path, optionally #Section"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(); }
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
            }}
          />
          <button className={styles.saveBtn} onClick={save}>Embed</button>
        </div>
      )}

      {!editing && (
        <div className={styles.content}>
          {loading && <div className={styles.stub}>Loading…</div>}
          {!loading && ref && !ref.found && (
            <div className={styles.stub}>No note found for “{displayTarget}”.</div>
          )}
          {!loading && ref?.found && (
            ref.body.trim()
              ? <MiniMarkdown body={ref.body} />
              : <div className={styles.stub}>This note is empty.</div>
          )}
        </div>
      )}
    </div>
  );
}

export const noteEmbedSpec = createReactBlockSpec(
  {
    type: "noteEmbed",
    propSchema: { target: { default: "" } },
    content: "none",
  },
  {
    render: (props) => <NoteEmbed block={props.block} editor={props.editor} />,
  },
)();

export function noteEmbedSlashItem(editor: any): DefaultReactSuggestionItem {
  return {
    title: "Embed note",
    subtext: "Transclude another note (![[note#section]])",
    aliases: ["embed", "transclude", "include", "reference"],
    group: "Data",
    onItemClick: () =>
      insertOrUpdateBlockForSlashMenu(editor, { type: "noteEmbed", props: { target: "" } } as never),
  };
}

// ── Boundary translation (mirror of the cortex-view inflate/flatten) ───────────

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : ""))
    .join("");
}

const EMBED_RE = /^!\[\[([^\]]+)\]\]$/;

/** Markdown → blocks: a paragraph that is exactly `![[target]]` becomes a live
 *  embed block. */
export function inflateEmbeds(blocks: any[]): any[] {
  return blocks.map((b) => {
    if (b?.type === "paragraph") {
      const m = inlineText(b.content).trim().match(EMBED_RE);
      if (m) return { type: "noteEmbed", props: { target: m[1].trim() } };
    }
    if (Array.isArray(b?.children) && b.children.length) {
      return { ...b, children: inflateEmbeds(b.children) };
    }
    return b;
  });
}

/** Blocks → markdown: collapse embed blocks back to a `![[target]]` paragraph. */
export function flattenEmbeds(blocks: any[]): any[] {
  // Blocks nested under an embed (Tab in the editor) are hoisted after the
  // `![[…]]` paragraph rather than lost on save.
  return blocks.flatMap((b) => {
    if (b?.type === "noteEmbed") {
      const para = {
        type: "paragraph",
        content: [{ type: "text", text: `![[${String(b.props?.target ?? "")}]]`, styles: {} }],
      };
      return [para, ...flattenEmbeds(Array.isArray(b.children) ? b.children : [])];
    }
    if (Array.isArray(b?.children) && b.children.length) {
      return [{ ...b, children: flattenEmbeds(b.children) }];
    }
    return [b];
  });
}
