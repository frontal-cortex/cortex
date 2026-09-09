// ── Transclusion block: `![[note]]` / `![[note#section]]` ──────────────────────
// Renders another note's content (or one section) inline and read-only — a live
// view, re-read from disk each mount, so edits to the source show up here. On
// disk it is ALWAYS the plain text `![[target]]` (human-readable, git-diffable);
// the custom block exists only in memory, translated at the load/save boundary
// exactly like the cortex-view block.

import { useState, useEffect, useCallback, createElement, Fragment } from "react";
import { createReactBlockSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { commands, NoteRef } from "../../lib/commands";
import { parseWikiLink, wikiLinkLabel } from "../../lib/wikiLink";
import { OpenIcon } from "./icons";
import styles from "./NoteEmbedBlock.module.css";

/** Ask the shell to navigate to a wiki target (reuses Shell's resolver). */
function navigateTo(target: string) {
  window.dispatchEvent(new CustomEvent("cortex:navigate", { detail: { target } }));
}

// ── Minimal markdown → React (headings, lists, quotes, paragraphs; inline
// bold/code and [[wiki links]]). Deliberately small: this is a preview, not the
// full editor. ───────────────────────────────────────────────────────────────

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Split on [[wiki]], **bold**, and `code`, keeping the delimiters.
  const re = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith("[[")) {
      const target = tok.slice(2, -2).trim();
      out.push(
        <span key={`${keyBase}-w${i}`} className={styles.wikiLink} onClick={() => navigateTo(target)}>
          {wikiLinkLabel(parseWikiLink(target))}
        </span>,
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={`${keyBase}-b${i}`}>{tok.slice(2, -2)}</strong>);
    } else {
      out.push(<code key={`${keyBase}-c${i}`} className={styles.code}>{tok.slice(1, -1)}</code>);
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) out.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last)}</Fragment>);
  return out;
}

function MiniMarkdown({ body }: { body: string }) {
  const lines = body.split("\n");
  const out: React.ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      out.push(<p key={`p${key++}`}>{renderInline(para.join(" "), `p${key}`)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      out.push(
        <ul key={`u${key++}`} className={styles.list}>
          {list.map((li, j) => <li key={j}>{renderInline(li, `u${key}-${j}`)}</li>)}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (heading) {
      flushPara(); flushList();
      const lvl = Math.min(heading[1].length, 6);
      const tag = `h${Math.min(lvl + 2, 6)}`;
      out.push(createElement(tag, { key: `h${key++}`, className: styles.heading }, renderInline(heading[2], `h${key}`)));
    } else if (bullet) {
      flushPara();
      list.push(bullet[1]);
    } else if (quote) {
      flushPara(); flushList();
      out.push(<blockquote key={`q${key++}`} className={styles.quote}>{renderInline(quote[1], `q${key}`)}</blockquote>);
    } else if (line.trim() === "") {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return <>{out}</>;
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
  return blocks.map((b) => {
    if (b?.type === "noteEmbed") {
      return {
        type: "paragraph",
        content: [{ type: "text", text: `![[${String(b.props?.target ?? "")}]]`, styles: {} }],
      };
    }
    if (Array.isArray(b?.children) && b.children.length) {
      return { ...b, children: flattenEmbeds(b.children) };
    }
    return b;
  });
}
