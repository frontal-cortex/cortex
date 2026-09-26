// The open page's place in the vault, across the top bar: vault › folder ›
// database › page — Notion's trail. A database crumb opens its page. A folder
// is not a page here, so its crumb opens what is inside it instead (folders,
// databases, notes in the sidebar's order), and a folder in that list drills
// in. Deep trails fold their middle into a "…" crumb that lists what it hides.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NoteEntry } from "../../lib/commands";
import type { ExplorerSort, TreeNode } from "../../lib/fileTree";
import { breadcrumbFor, folderContents, type Crumb } from "../../lib/breadcrumb";
import { ChevronRightIcon, ChevronLeftIcon, FolderIcon, FileIcon, DatabaseIcon } from "./icons";
import styles from "./Breadcrumb.module.css";

interface Props {
  vaultName: string;
  /** The open note's vault-relative path. */
  path: string;
  notes: NoteEntry[];
  dirs: string[];
  explorerSort: ExplorerSort;
  onOpenNote: (path: string) => void;
  onOpenCollection: (name: string) => void;
}

/** More ancestors than this and the middle folds into "…". */
const MAX_INLINE = 3;

/** One page of the popover: the crumbs the "…" hides, or a folder's contents. */
type MenuView = { kind: "hidden" } | { kind: "dir"; path: string; label: string };
interface Menu {
  /** Which crumb the popover hangs under: a folder path, or "…". */
  anchor: string;
  /** Drill-down history; the last entry is on show, the back button pops. */
  stack: MenuView[];
}

export function Breadcrumb({ vaultName, path, notes, dirs, explorerSort, onOpenNote, onOpenCollection }: Props) {
  const crumbs = useMemo(() => breadcrumbFor(path, notes), [path, notes]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const ref = useRef<HTMLElement>(null);

  // A new page closes whatever was open.
  useEffect(() => { setMenu(null); }, [path]);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [menu]);

  if (crumbs.length === 0) return <span className={styles.vault}>{vaultName}</span>;

  const current = crumbs[crumbs.length - 1];
  const ancestors = crumbs.slice(0, -1);
  const folded = ancestors.length > MAX_INLINE;
  const hidden = folded ? ancestors.slice(1, -1) : [];
  const inline: (Crumb | "…")[] = folded ? [ancestors[0], "…", ancestors[ancestors.length - 1]] : ancestors;

  const open = (c: Crumb) => {
    setMenu(null);
    if (c.kind === "collection") onOpenCollection(c.collection);
    else onOpenNote(c.path);
  };
  const toggle = (anchor: string, view: MenuView) =>
    setMenu((m) => (m?.anchor === anchor ? null : { anchor, stack: [view] }));
  const drill = (view: MenuView) => setMenu((m) => (m ? { ...m, stack: [...m.stack, view] } : m));
  const back = () => setMenu((m) => (m && m.stack.length > 1 ? { ...m, stack: m.stack.slice(0, -1) } : m));

  return (
    <nav className={styles.crumbs} aria-label="Where this page is" ref={ref}>
      <span className={`${styles.vault} ${styles.vaultMuted}`} title={vaultName}>{vaultName}</span>
      {inline.map((c) => {
        if (c === "…") {
          return (
            <span key="…" className={styles.crumb}>
              <Sep />
              <button
                className={`${styles.btn} ${menu?.anchor === "…" ? styles.btnOn : ""}`}
                onClick={() => toggle("…", { kind: "hidden" })}
                title={hidden.map((h) => h.label).join(" › ")}
                aria-haspopup="menu"
                aria-expanded={menu?.anchor === "…"}
              >…</button>
              {menu?.anchor === "…" && <Popover menu={menu} hidden={hidden} notes={notes} dirs={dirs} sort={explorerSort} onOpen={open} onDrill={drill} onBack={back} />}
            </span>
          );
        }
        const on = menu?.anchor === c.path;
        return (
          <span key={c.path} className={styles.crumb}>
            <Sep />
            {c.kind === "dir" ? (
              <button
                className={`${styles.btn} ${on ? styles.btnOn : ""}`}
                onClick={() => toggle(c.path, { kind: "dir", path: c.path, label: c.label })}
                title={c.path}
                aria-haspopup="menu"
                aria-expanded={on}
              >{c.label}</button>
            ) : (
              <button className={styles.btn} onClick={() => open(c)} title={c.path}>
                <CrumbIcon crumb={c} />{c.label}
              </button>
            )}
            {on && <Popover menu={menu} hidden={hidden} notes={notes} dirs={dirs} sort={explorerSort} onOpen={open} onDrill={drill} onBack={back} />}
          </span>
        );
      })}
      <span className={styles.crumb}>
        <Sep />
        <span className={styles.current} title={current.path} aria-current="page">
          <CrumbIcon crumb={current} />{current.label}
        </span>
      </span>
    </nav>
  );
}

function Sep() {
  return <span className={styles.sep} aria-hidden><ChevronRightIcon size={12} /></span>;
}

/** A page's own emoji in the trail; nothing for folders or iconless pages. */
function CrumbIcon({ crumb }: { crumb: Crumb }) {
  if (crumb.kind === "dir" || !crumb.icon) return null;
  return <span className={styles.emoji}>{crumb.icon}</span>;
}

function Popover({ menu, hidden, notes, dirs, sort, onOpen, onDrill, onBack }: {
  menu: Menu;
  hidden: Crumb[];
  notes: NoteEntry[];
  dirs: string[];
  sort: ExplorerSort;
  onOpen: (c: Crumb) => void;
  onDrill: (view: MenuView) => void;
  onBack: () => void;
}) {
  const view = menu.stack[menu.stack.length - 1];
  const contents = useMemo(
    () => (view.kind === "dir" ? folderContents(view.path, notes, dirs, sort) : []),
    [view, notes, dirs, sort],
  );

  let items: ReactNode;
  if (view.kind === "hidden") {
    items = hidden.map((c) => (
      <Item
        key={c.path}
        icon={c.kind === "dir" ? <FolderIcon size={14} /> : c.icon ? <span className={styles.emoji}>{c.icon}</span> : <DatabaseIcon size={14} />}
        label={c.label}
        title={c.path}
        trailing={c.kind === "dir" ? <ChevronRightIcon size={12} /> : undefined}
        onClick={() => (c.kind === "dir" ? onDrill({ kind: "dir", path: c.path, label: c.label }) : onOpen(c))}
      />
    ));
  } else if (contents.length === 0) {
    items = <div className={styles.empty}>Nothing here yet</div>;
  } else {
    items = contents.map((n: TreeNode) => {
      if (n.type === "dir") {
        return <Item key={n.path} icon={<FolderIcon size={14} />} label={n.name} title={n.path} trailing={<ChevronRightIcon size={12} />} onClick={() => onDrill({ kind: "dir", path: n.path, label: n.name })} />;
      }
      if (n.type === "collection") {
        const icon = n.icon ? <span className={styles.emoji}>{n.icon}</span> : <DatabaseIcon size={14} />;
        return <Item key={n.path} icon={icon} label={n.name} title={n.path} onClick={() => onOpen({ kind: "collection", label: n.name, path: n.path, collection: n.collection, icon: n.icon })} />;
      }
      const icon = n.note.icon ? <span className={styles.emoji}>{n.note.icon}</span> : <FileIcon size={14} />;
      return <Item key={n.path} icon={icon} label={n.name} title={n.path} onClick={() => onOpen({ kind: "note", label: n.name, path: n.path, icon: n.note.icon })} />;
    });
  }

  return (
    <div className={styles.menu} role="menu">
      {view.kind === "dir" && (
        <div className={styles.head}>
          {menu.stack.length > 1 && (
            <button className={styles.back} onClick={onBack} title="Back" aria-label="Back"><ChevronLeftIcon size={13} /></button>
          )}
          <FolderIcon size={13} open />
          <span className={styles.headLabel} title={view.path}>{view.label}</span>
        </div>
      )}
      {items}
    </div>
  );
}

function Item({ icon, label, title, trailing, onClick }: { icon: ReactNode; label: string; title: string; trailing?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className={styles.item} title={title} onClick={onClick}>
      <span className={styles.itemIcon}>{icon}</span>
      <span className={styles.itemLabel}>{label}</span>
      {trailing && <span className={styles.itemTrailing}>{trailing}</span>}
    </button>
  );
}
