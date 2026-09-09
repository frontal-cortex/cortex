// ── Collection views block ────────────────────────────────────────────────────
// A collection's page is its `_index.md`: an ordinary note whose frontmatter
// holds the views. The page opens in the normal editor, and this block is
// where the views appear in it — at the top by default, or wherever the note
// puts a ```cortex-views fence — so prose can sit above, below or between:
// why this collection exists, how to use it, a weekly summary.
//
// The same block in any other note shows that collection's own views live;
// view edits made there write to the collection's `_index.md`, so there is one
// set of views however many notes show them.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createReactBlockSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { commands, Note, ViewDef } from "../../lib/commands";
import { parseViews, defaultViews, viewToFrontmatter, viewSource } from "../../lib/database";
import { exportToFile } from "../../lib/export";
import { DataViews } from "./DataViews";
import { DatabaseIcon } from "./icons";
import styles from "./CollectionViewsBlock.module.css";

/** What the editor provides when the open note is a collection's own page. */
export interface CollectionPage {
  collection: string;
  views: ViewDef[];
  setViews: (views: ViewDef[]) => void;
  onConvertToNote?: () => void;
}
export const CollectionPageContext = createContext<CollectionPage | null>(null);

/** The fence language that carries the block in Markdown. */
export const VIEWS_FENCE = "cortex-views";

function CollectionViewsBlock({ block, editor }: { block: any; editor: any }) {
  const page = useContext(CollectionPageContext);
  const own = String(block.props.collection ?? "").trim();
  // Bound: this is the collection's own page and the block shows its views.
  const bound = !!page && (!own || own === page.collection);
  const collection = own || page?.collection || "";

  // Unbound: another note showing a collection — read its `_index.md`, write back there.
  const [remote, setRemote] = useState<{ note: Note; views: ViewDef[] } | null>(null);
  useEffect(() => {
    if (bound || !collection) { setRemote(null); return; }
    let alive = true;
    commands.readNote(`collections/${collection}/_index.md`)
      .then((n) => { if (alive) setRemote({ note: n, views: parseViews(n.frontmatter) }); })
      .catch(() => { if (alive) setRemote(null); });
    return () => { alive = false; };
  }, [bound, collection]);
  const persistRemote = (views: ViewDef[]) => {
    if (!remote) return;
    const note: Note = { ...remote.note, frontmatter: { ...remote.note.frontmatter, type: "database", views: views.map(viewToFrontmatter) } };
    setRemote({ note, views });
    commands.writeNote(note.path, note).catch(() => {});
  };

  if (!collection) return <Picker onPick={(c) => editor.updateBlock(block, { props: { collection: c } })} />;

  const views = bound ? page!.views : remote?.views ?? [];
  const setViews = bound ? page!.setViews : persistRemote;
  const source = viewSource(collection);

  const menu = (
    <Menu
      items={[
        { label: "Export to CSV", run: () => exportToFile("collection-csv", source, `${collection}.csv`) },
        { label: "Export to HTML", run: () => exportToFile("collection-html", source, `${collection}.html`) },
        ...(bound && page?.onConvertToNote ? [{ label: "Convert to checklist note", run: page.onConvertToNote }] : []),
        ...(!bound ? [{ label: "Open the collection", run: () => window.dispatchEvent(new CustomEvent("cortex:open-note", { detail: { path: `collections/${collection}/_index.md` } })) }] : []),
      ]}
    />
  );

  return (
    <div className={`${styles.block} ${bound ? styles.bound : ""}`} contentEditable={false}>
      {!bound && (
        <div className={styles.bar}>
          <span className={styles.name} title={`The views of collections/${collection}, as on its own page`}>
            <DatabaseIcon size={13} /> {collection}
          </span>
          {menu}
        </div>
      )}
      <DataViews
        key={`${collection}:${bound}`}
        source={source}
        views={views.length ? views : defaultViews()}
        onViewsChange={setViews}
        hotkeys={bound}
        trailing={bound ? menu : undefined}
      />
    </div>
  );
}

function Menu({ items }: { items: { label: string; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className={styles.menuWrap} ref={ref}>
      <button className={styles.menuBtn} title="Collection options" onClick={() => setOpen((o) => !o)}>⋯</button>
      {open && (
        <div className={styles.menu}>
          {items.map((it) => (
            <button key={it.label} className={styles.menuItem} onClick={() => { setOpen(false); it.run(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** No collection named yet (inserted from the slash menu): pick one. */
function Picker({ onPick }: { onPick: (collection: string) => void }) {
  const [collections, setCollections] = useState<string[]>([]);
  useEffect(() => { commands.listCollections().then(setCollections).catch(() => {}); }, []);
  return (
    <div className={styles.setup} contentEditable={false}>
      <DatabaseIcon size={20} />
      <div className={styles.setupTitle}>Which collection's views?</div>
      {collections.length === 0
        ? <div className={styles.setupHint}>No collections yet — create one from the sidebar first.</div>
        : <div className={styles.chips}>{collections.map((c) => <button key={c} className={styles.chip} onClick={() => onPick(c)}>{c}</button>)}</div>}
    </div>
  );
}

export const collectionViewsSpec = createReactBlockSpec(
  {
    type: "collectionViews",
    propSchema: { collection: { default: "" } },
    content: "none",
  },
  { render: (props) => <CollectionViewsBlock block={props.block} editor={props.editor} /> },
)();

// ── Markdown boundary ─────────────────────────────────────────────────────────
// On disk the block is a ```cortex-views fence holding `collection: <name>` —
// a legible stub in any other Markdown tool, and diff-friendly.

export function inflateCollectionViews(blocks: any[]): any[] {
  return blocks.map((b) => {
    if (b?.type === "codeBlock" && b?.props?.language === VIEWS_FENCE) {
      const text = Array.isArray(b.content) ? b.content.map((c: any) => (c && typeof c === "object" && "text" in c ? String(c.text) : "")).join("") : "";
      const collection = /^collection:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "";
      return { type: "collectionViews", props: { collection } };
    }
    if (Array.isArray(b?.children) && b.children.length) return { ...b, children: inflateCollectionViews(b.children) };
    return b;
  });
}

export function flattenCollectionViews(blocks: any[]): any[] {
  return blocks.map((b) => {
    if (b?.type === "collectionViews") {
      const c = String(b.props?.collection ?? "").trim();
      return { type: "codeBlock", props: { language: VIEWS_FENCE }, content: [{ type: "text", text: c ? `collection: ${c}` : "", styles: {} }] };
    }
    if (Array.isArray(b?.children) && b.children.length) return { ...b, children: flattenCollectionViews(b.children) };
    return b;
  });
}

/** A collection's own page always shows its views: add the block at the top
 *  when the note has no fence yet. Idempotent. */
export function ensureCollectionViewsBlock(editor: any, collection: string): void {
  const has = (blocks: any[]): boolean => blocks.some((b) => b?.type === "collectionViews" || (Array.isArray(b?.children) && has(b.children)));
  if (has(editor.document)) return;
  const first = editor.document[0];
  const block = { type: "collectionViews", props: { collection } } as never;
  if (first) editor.insertBlocks([block], first, "before");
  else editor.replaceBlocks(editor.document, [block]);
}

export function collectionViewsSlashItem(editor: any): DefaultReactSuggestionItem {
  return {
    title: "Collection views",
    subtext: "A collection's own table, board, calendar… live in this note",
    aliases: ["collection", "views", "database", "table"],
    group: "Data",
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "collectionViews", props: { collection: "" } } as never),
  };
}
