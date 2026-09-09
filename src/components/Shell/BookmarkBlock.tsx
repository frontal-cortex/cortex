// ── Bookmark block: a link card ───────────────────────────────────────────────
// On disk it is a plain `[Label](https://…)` alone in a paragraph — nothing a
// Markdown reader would not show as a link. The card's title, description,
// favicon and image are a preview the app fetches once (`fetch_link_preview`)
// and keeps in `.brain/previews/`; they never touch the file. Offline, or
// when a site gives nothing back, the card is the bare link. The block exists
// only in memory; src/lib/webBlocks.ts translates it at the load/save boundary.

import { useEffect, useState } from "react";
import { createReactBlockSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { commands, LinkPreview } from "../../lib/commands";
import { bookmarkLabel, isWebUrl, soleWebLink } from "../../lib/webBlocks";
import { openExternal } from "../../lib/links";
import { GlobeIcon, OpenIcon, SyncIcon } from "./icons";
import styles from "./BookmarkBlock.module.css";

function Bookmark({ block, editor }: { block: any; editor: any }) {
  const url = String(block.props.url ?? "").trim();
  const title = String(block.props.title ?? "").trim();
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(!url);
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftTitle, setDraftTitle] = useState(title);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!url) { setPreview(null); return; }
    let alive = true;
    setLoading(true);
    commands.fetchLinkPreview(url, refreshToken > 0)
      .then((p) => { if (alive) setPreview(p); })
      .catch(() => { if (alive) setPreview(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [url, refreshToken]);

  const save = () => {
    const u = draftUrl.trim();
    if (!isWebUrl(u)) return;
    editor.updateBlock(block, { props: { url: u, title: draftTitle.trim() } });
    setEditing(false);
  };
  const cancel = () => {
    if (!url) {
      // Nothing was ever entered: the block goes away instead of lingering empty.
      editor.replaceBlocks([block], [{ type: "paragraph" }]);
      return;
    }
    setEditing(false);
  };
  /** Back to text: the bare URL, which stays plain text across reloads. */
  const toText = () => {
    editor.replaceBlocks([block], [{ type: "paragraph", content: [{ type: "text", text: url, styles: {} }] }]);
  };

  const ok = preview && !preview.error;
  const shownTitle = (ok && preview.title) || title || bookmarkLabel(url);
  const domain = preview?.domain || bookmarkLabel(url).split("/")[0];
  const [faviconBroken, setFaviconBroken] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  useEffect(() => { setFaviconBroken(false); setImageBroken(false); }, [preview]);

  return (
    <div className={styles.bookmark} contentEditable={false} data-editing={editing ? "" : undefined}>
      {editing ? (
        <div className={styles.form}>
          <input
            className={styles.input}
            autoFocus
            value={draftUrl}
            placeholder="https://…"
            spellCheck={false}
            onChange={(e) => setDraftUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(); }
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
              e.stopPropagation();
            }}
          />
          <input
            className={styles.input}
            value={draftTitle}
            placeholder="Label (optional — the file reads [Label](url))"
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(); }
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
              e.stopPropagation();
            }}
          />
          <div className={styles.formActions}>
            <button className={styles.saveBtn} onClick={save} disabled={!isWebUrl(draftUrl)}>Bookmark</button>
            <button className={styles.btn} onClick={cancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {/* A plain anchor: the app's link guard opens it in the browser. */}
          <a className={styles.card} href={url} title={url}>
            <div className={styles.text}>
              <div className={styles.title}>{shownTitle}</div>
              {ok && preview.description && <div className={styles.description}>{preview.description}</div>}
              <div className={styles.meta}>
                {ok && preview.favicon && !faviconBroken
                  ? <img className={styles.favicon} src={preview.favicon} alt="" onError={() => setFaviconBroken(true)} />
                  : <span className={styles.faviconStub}><GlobeIcon size={12} /></span>}
                <span className={styles.site}>{(ok && preview.site_name) || domain}</span>
                <span className={styles.url}>{url}</span>
              </div>
            </div>
            {ok && preview.image && !imageBroken && (
              <div className={styles.thumb}>
                <img src={preview.image} alt="" onError={() => setImageBroken(true)} />
              </div>
            )}
          </a>
          <div className={styles.actions}>
            {loading && <span className={styles.status}>Fetching…</span>}
            {!loading && preview?.error && <span className={styles.status} title={preview.error}>No preview</span>}
            <button className={styles.btn} onClick={() => { setDraftUrl(url); setDraftTitle(title); setEditing(true); }}>Edit</button>
            <button className={styles.btn} onClick={() => setRefreshToken((t) => t + 1)} title="Fetch the preview again"><SyncIcon size={12} /></button>
            <button className={styles.btn} onClick={() => void openExternal(url)} title="Open in browser"><OpenIcon size={12} /></button>
            <button className={styles.btn} onClick={toText} title="Replace the card with the bare URL">Text</button>
          </div>
        </>
      )}
    </div>
  );
}

export const bookmarkSpec = createReactBlockSpec(
  {
    type: "bookmark",
    propSchema: { url: { default: "" }, title: { default: "" } },
    content: "none",
  },
  {
    render: (props) => <Bookmark block={props.block} editor={props.editor} />,
  },
)();

export function bookmarkSlashItem(editor: any): DefaultReactSuggestionItem {
  return {
    title: "Bookmark",
    subtext: "A link card with the page's title and preview ([title](url))",
    aliases: ["bookmark", "link card", "preview", "url", "web link"],
    group: "Media",
    icon: <GlobeIcon size={18} />,
    onItemClick: () =>
      insertOrUpdateBlockForSlashMenu(editor, { type: "bookmark", props: { url: "", title: "" } } as never),
  };
}

/** Turn the link at `range` into a bookmark or an embed block. When the link
 *  is the whole paragraph the paragraph becomes the block; otherwise the link
 *  text is removed and the block goes in after the paragraph. */
export function turnLinkInto(editor: any, kind: "bookmark" | "webEmbed", url: string, text: string, range: { from: number; to: number }) {
  if (!isWebUrl(url)) return;
  const tt = editor._tiptapEditor;
  tt.commands.setTextSelection(range.from);
  let block: any;
  try { block = editor.getTextCursorPosition().block; } catch { return; }
  const label = text.trim() === url.trim() || text.trim() === bookmarkLabel(url) ? "" : text.trim();
  const fresh = kind === "bookmark"
    ? { type: "bookmark", props: { url: url.trim(), title: label } }
    : { type: "webEmbed", props: { url: url.trim() } };
  const whole = block.type === "paragraph" && soleWebLink(block.content)?.href === url.trim();
  if (whole) {
    editor.replaceBlocks([block], [fresh]);
  } else {
    tt.commands.deleteRange(range);
    editor.insertBlocks([fresh], block, "after");
  }
}
