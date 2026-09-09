// ── Web embed block: a page in a frame ───────────────────────────────────────
// On disk it is a CommonMark autolink alone in a paragraph, `<https://…>`,
// which every Markdown renderer shows as a link (an `<iframe>` would vanish
// on GitHub). Which URLs may be framed, and the player URL for each, is
// decided in cortex-core (`embed::resolve`) — the same table the webview's
// navigation guard consults — so the app asks it through `resolve_embed`
// rather than keeping its own list. YouTube, Vimeo, CodePen, Figma and Google
// Maps load at once; any other https page sits behind a click-to-load shield.
// The block exists only in memory; src/lib/webBlocks.ts does the translation.

import { useEffect, useState } from "react";
import { createReactBlockSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { commands, Embed } from "../../lib/commands";
import { bookmarkLabel, isWebUrl } from "../../lib/webBlocks";
import { openExternal } from "../../lib/links";
import { GlobeIcon, OpenIcon } from "./icons";
import styles from "./WebEmbedBlock.module.css";

const PROVIDER_LABEL: Record<Embed["provider"], string> = {
  youtube: "YouTube", vimeo: "Vimeo", codepen: "CodePen", figma: "Figma", maps: "Google Maps", web: "Web",
};

// No `allow-popups`: the frame cannot open windows; "Open" is the way out.
const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-presentation";
const ALLOW = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";

function WebEmbed({ block, editor }: { block: any; editor: any }) {
  const url = String(block.props.url ?? "").trim();
  // undefined: still asking; null: not embeddable (only https pages are).
  const [embed, setEmbed] = useState<Embed | null | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(!url);
  const [draft, setDraft] = useState(url);

  useEffect(() => {
    setLoaded(false);
    if (!url) { setEmbed(null); return; }
    let alive = true;
    setEmbed(undefined);
    commands.resolveEmbed(url)
      .then((e) => { if (alive) setEmbed(e); })
      .catch(() => { if (alive) setEmbed(null); });
    return () => { alive = false; };
  }, [url]);

  const save = () => {
    const u = draft.trim();
    if (!isWebUrl(u)) return;
    editor.updateBlock(block, { props: { url: u } });
    setEditing(false);
  };
  const cancel = () => {
    if (!url) { editor.replaceBlocks([block], [{ type: "paragraph" }]); return; }
    setEditing(false);
  };
  const load = async () => {
    // Tell the navigation guard this host may load in a frame, then render.
    try { await commands.allowEmbedFrame(url); } catch { /* the frame simply stays blank */ }
    setLoaded(true);
  };

  const domain = bookmarkLabel(url).split("/")[0];
  const label = embed ? PROVIDER_LABEL[embed.provider] ?? "Web" : "Embed";

  return (
    <div className={styles.embed} contentEditable={false}>
      <div className={styles.bar}>
        <span className={styles.badge}>{label}</span>
        <span className={styles.meta} title={url}>{domain || "No link yet"}</span>
        {url && (
          <button className={styles.btn} onClick={() => void openExternal(url)} title="Open in browser"><OpenIcon size={12} /></button>
        )}
        <button className={styles.btn} onClick={() => { setDraft(url); setEditing((e) => !e); }}>
          {editing ? "Close" : "Change"}
        </button>
      </div>

      {editing && (
        <div className={styles.form}>
          <input
            className={styles.input}
            autoFocus
            value={draft}
            placeholder="https://www.youtube.com/watch?v=… — YouTube, Vimeo, CodePen, Figma, Maps or any https page"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(); }
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
              e.stopPropagation();
            }}
          />
          <button className={styles.saveBtn} onClick={save} disabled={!isWebUrl(draft)}>Embed</button>
        </div>
      )}

      {!editing && url && embed === null && (
        <div className={styles.shield}>
          <GlobeIcon size={20} />
          <div>Only <code>https://</code> pages can be embedded. <a href={url}>{url}</a></div>
        </div>
      )}

      {!editing && embed && embed.shield && !loaded && (
        <div className={styles.shield}>
          <GlobeIcon size={20} />
          <div className={styles.shieldText}>
            <div>Load <strong>{domain}</strong> in a frame?</div>
            <div className={styles.shieldHint}>Nothing is fetched until you say so. Some sites refuse to be framed and stay blank — "Open" always works.</div>
          </div>
          <div className={styles.shieldActions}>
            <button className={styles.saveBtn} onClick={() => void load()}>Load</button>
            <button className={styles.btn} onClick={() => void openExternal(url)}>Open</button>
          </div>
        </div>
      )}

      {!editing && embed && (!embed.shield || loaded) && (
        <iframe
          className={embed.aspect === "video" ? styles.video : styles.page}
          src={embed.src}
          title={`${label}: ${domain}`}
          sandbox={SANDBOX}
          allow={ALLOW}
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
    </div>
  );
}

export const webEmbedSpec = createReactBlockSpec(
  {
    type: "webEmbed",
    propSchema: { url: { default: "" } },
    content: "none",
  },
  {
    render: (props) => <WebEmbed block={props.block} editor={props.editor} />,
  },
)();

export function webEmbedSlashItem(editor: any): DefaultReactSuggestionItem {
  return {
    title: "Web embed",
    subtext: "YouTube, Vimeo, CodePen, Figma, Maps or any https page in a frame (<url>)",
    aliases: ["embed", "iframe", "youtube", "vimeo", "video", "website", "figma", "codepen", "map"],
    group: "Media",
    icon: <GlobeIcon size={18} />,
    onItemClick: () =>
      insertOrUpdateBlockForSlashMenu(editor, { type: "webEmbed", props: { url: "" } } as never),
  };
}
