import { useState, useEffect, useRef, CSSProperties, ReactNode, MouseEvent as ReactMouseEvent } from "react";
import { TreeNode, DirNode, FileNode, CollectionNode, isUntitled, relativeTime } from "../../lib/fileTree";
import { exportToFile } from "../../lib/export";
import { shortcutFor } from "../../lib/keymap";
import {
  StarIcon, StarFilledIcon, ChevronRightIcon, FolderIcon, FolderPlusIcon, FilePlusIcon, FileIcon, TrashIcon, DatabaseIcon,
} from "./icons";
import { RowA11y } from "./treeRows";
import styles from "./FileTree.module.css";

export interface TreeActions {
  newFolderIn: string | null;
  onNewFolderRequest: (parentPath: string) => void;
  onNewFolderSubmit: (parentPath: string, name: string) => void;
  onNewFolderCancel: () => void;
  onNewNoteInFolder: (parentPath: string) => void;
  onDeleteFolder: (path: string) => void;
  onMoveNote: (fromPath: string, toDir: string) => void;
  onRenameFile?: (path: string) => void;
  onDuplicateFile?: (path: string) => void;
  onRevealFile?: (path: string) => void;
  onDeleteFile?: (path: string) => void;
  onTurnIntoDatabase?: (path: string) => void;
  onToggleFavorite?: (path: string) => void;
  isFavorite?: (path: string) => boolean;
  // Collections — pages among pages; rows never appear in the tree.
  onOpenCollection?: (name: string) => void;
  onRenameCollection?: (name: string) => void;
  onDeleteCollection?: (name: string) => void;
  /** Nest a collection under another collection, a `notes/<folder>/` path, or null for the top level. */
  onMoveCollection?: (name: string, parent: string | null) => void;
}

/** Drag payload for a collection row (notes carry their path as plain text). */
export const COLLECTION_DRAG = "collection:";

/** Roving-tabindex attributes for a row id; undefined when the id isn't a row. */
export type A11yFor = (id: string, selected?: boolean) => RowA11y | undefined;

interface Props {
  nodes: TreeNode[];
  /** Vault-relative path of this tree level's parent, e.g. "notes/" */
  currentPath: string;
  selectedPath: string | null;
  /** Nesting depth of this level; 0 directly under a section header. */
  depth?: number;
  /** Folder open state lives in LeftPanel so the keyboard's row list and the
   *  rendered rows can never disagree about what is visible. */
  isDirOpen: (path: string, depth: number) => boolean;
  onToggleDir: (path: string, open?: boolean) => void;
  actions: TreeActions;
  onSelect: (path: string) => void;
  a11y: A11yFor;
}

export function FileTree({
  nodes, currentPath, selectedPath, depth = 0, isDirOpen, onToggleDir, actions, onSelect, a11y,
}: Props) {
  return (
    <div role={depth === 0 ? undefined : "group"}>
      {nodes.map((node) =>
        node.type === "collection" ? (
          <CollectionRow
            key={node.path}
            node={node}
            selectedPath={selectedPath}
            depth={depth}
            open={isDirOpen(node.path, depth)}
            isDirOpen={isDirOpen}
            onToggleDir={onToggleDir}
            actions={actions}
            onSelect={onSelect}
            a11y={a11y}
          />
        ) : node.type === "dir" ? (
          <DirRow
            key={node.path}
            node={node}
            selectedPath={selectedPath}
            depth={depth}
            open={isDirOpen(node.path, depth)}
            isDirOpen={isDirOpen}
            onToggleDir={onToggleDir}
            actions={actions}
            onSelect={onSelect}
            a11y={a11y}
          />
        ) : (
          <FileRow
            key={node.path}
            node={node}
            selected={node.path === selectedPath}
            depth={depth}
            actions={actions}
            onSelect={onSelect}
            a11y={a11y}
          />
        ),
      )}

      {/* Inline new-folder input rendered at this tree level */}
      {actions.newFolderIn === currentPath && (
        <NewFolderInput
          depth={depth}
          onSubmit={(name) => actions.onNewFolderSubmit(currentPath, name)}
          onCancel={actions.onNewFolderCancel}
        />
      )}
    </div>
  );
}

/** Indent is one CSS variable so every row kind shares the same rhythm. */
export function rowStyle(depth: number): CSSProperties {
  return { ["--depth" as string]: depth } as CSSProperties;
}

// ── Folder row ────────────────────────────────────────────────────────────────

function DirRow({
  node, selectedPath, depth, open, isDirOpen, onToggleDir, actions, onSelect, a11y,
}: {
  node: DirNode;
  selectedPath: string | null;
  depth: number;
  open: boolean;
  isDirOpen: Props["isDirOpen"];
  onToggleDir: Props["onToggleDir"];
  actions: TreeActions;
  onSelect: (path: string) => void;
  a11y: A11yFor;
}) {
  const [dragOver, setDragOver] = useState(false);
  const count = countFiles(node);

  return (
    <div>
      <div
        {...a11y(node.path)}
        className={`${styles.row} ${styles.dirRow} ${dragOver ? styles.dirRowDropTarget : ""}`}
        style={rowStyle(depth)}
        title={`${node.name} · ${count} note${count === 1 ? "" : "s"}`}
        onClick={() => onToggleDir(node.path)}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={(e) => { e.stopPropagation(); setDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation();
          setDragOver(false);
          const path = e.dataTransfer.getData("text/plain");
          if (path.startsWith(COLLECTION_DRAG)) {
            actions.onMoveCollection?.(path.slice(COLLECTION_DRAG.length), node.path);
          } else if (path && path !== node.path && !path.startsWith(node.path)) {
            actions.onMoveNote(path, node.path);
          }
        }}
      >
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} aria-hidden>
          <ChevronRightIcon size={12} />
        </span>
        <span className={styles.rowIcon}><FolderIcon open={open} /></span>
        <span className={styles.dirName}>{node.name}</span>

        {/* Hover affordances only — the keyboard has n / Delete for these. */}
        <div className={styles.rowActions}>
          <button
            className={styles.rowActionBtn}
            tabIndex={-1}
            title={`New note here (n)`}
            onClick={(e) => { e.stopPropagation(); actions.onNewNoteInFolder(node.path); }}
          >
            <FilePlusIcon size={13} />
          </button>
          <button
            className={styles.rowActionBtn}
            tabIndex={-1}
            title="New folder here"
            onClick={(e) => { e.stopPropagation(); onToggleDir(node.path, true); actions.onNewFolderRequest(node.path); }}
          >
            <FolderPlusIcon size={13} />
          </button>
          <button
            className={`${styles.rowActionBtn} ${styles.rowActionBtnDanger}`}
            tabIndex={-1}
            title="Delete folder"
            onClick={(e) => { e.stopPropagation(); actions.onDeleteFolder(node.path); }}
          >
            <TrashIcon size={12} />
          </button>
        </div>
        <span className={styles.count}>{count}</span>
      </div>

      {open && (
        <FileTree
          nodes={node.children}
          currentPath={node.path}
          selectedPath={selectedPath}
          depth={depth + 1}
          isDirOpen={isDirOpen}
          onToggleDir={onToggleDir}
          actions={actions}
          onSelect={onSelect}
          a11y={a11y}
        />
      )}
    </div>
  );
}

// ── Collection row ────────────────────────────────────────────────────────────
// A collection is a page: its title and icon from `_index.md`, a chevron only
// when other collections nest under it, and a context menu like a note's.

function CollectionRow({
  node, selectedPath, depth, open, isDirOpen, onToggleDir, actions, onSelect, a11y,
}: {
  node: CollectionNode;
  selectedPath: string | null;
  depth: number;
  open: boolean;
  isDirOpen: Props["isDirOpen"];
  onToggleDir: Props["onToggleDir"];
  actions: TreeActions;
  onSelect: (path: string) => void;
  a11y: A11yFor;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const hasChildren = node.children.length > 0;
  const selected = node.path === selectedPath;
  const openIt = () => (actions.onOpenCollection ? actions.onOpenCollection(node.collection) : onSelect(node.path));

  return (
    <div>
      <div
        {...a11y(node.path, selected)}
        className={`${styles.row} ${selected ? styles.rowSelected : ""} ${dragOver ? styles.dirRowDropTarget : ""} ${menu ? styles.rowContext : ""}`}
        style={rowStyle(depth)}
        title={`${node.name} · collections/${node.collection}`}
        onClick={openIt}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", `${COLLECTION_DRAG}${node.collection}`);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={(e) => { e.stopPropagation(); setDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation();
          setDragOver(false);
          const data = e.dataTransfer.getData("text/plain");
          if (data.startsWith(COLLECTION_DRAG)) {
            const c = data.slice(COLLECTION_DRAG.length);
            if (c && c !== node.collection) actions.onMoveCollection?.(c, node.collection);
          }
        }}
      >
        <span
          className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
          style={hasChildren ? undefined : { visibility: "hidden" }}
          aria-hidden
          onClick={(e) => { if (hasChildren) { e.stopPropagation(); onToggleDir(node.path); } }}
        >
          <ChevronRightIcon size={12} />
        </span>
        <span className={styles.rowIcon}>
          {node.icon ? <span className={styles.emoji}>{node.icon}</span> : <DatabaseIcon size={13} />}
        </span>
        <span className={styles.label}>{node.name}</span>
        {hasChildren && <span className={styles.count}>{node.children.length}</span>}
        {menu && (
          <CollectionContextMenu
            x={menu.x}
            y={menu.y}
            node={node}
            nested={depth > 0}
            actions={actions}
            onClose={() => setMenu(null)}
          />
        )}
      </div>

      {open && hasChildren && (
        <FileTree
          nodes={node.children}
          currentPath={node.path}
          selectedPath={selectedPath}
          depth={depth + 1}
          isDirOpen={isDirOpen}
          onToggleDir={onToggleDir}
          actions={actions}
          onSelect={onSelect}
          a11y={a11y}
        />
      )}
    </div>
  );
}

function CollectionContextMenu({
  x, y, node, nested, actions, onClose,
}: {
  x: number; y: number; node: CollectionNode; nested: boolean; actions: TreeActions; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 200);
  const run = (fn?: () => void) => (e: ReactMouseEvent) => { e.stopPropagation(); onClose(); fn?.(); };
  const c = node.collection;
  return (
    <div ref={ref} className={styles.ctxMenu} style={{ left, top }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button className={styles.ctxItem} onClick={run(() => actions.onOpenCollection?.(c))}>Open</button>
      <button className={styles.ctxItem} onClick={run(() => actions.onRenameCollection?.(c))}>Rename</button>
      {nested && <button className={styles.ctxItem} onClick={run(() => actions.onMoveCollection?.(c, null))}>Move to top level</button>}
      <button className={styles.ctxItem} onClick={run(() => exportToFile("collection-csv", `collections/${c}`, `${c}.csv`))}>Export to CSV</button>
      <button className={styles.ctxItem} onClick={run(() => { navigator.clipboard?.writeText(`collections/${c}`); })}>Copy path</button>
      <div className={styles.ctxSep} />
      <button className={`${styles.ctxItem} ${styles.ctxItemDanger}`} onClick={run(() => actions.onDeleteCollection?.(c))}>
        Move to trash <span className={styles.ctxHint}>Del</span>
      </button>
    </div>
  );
}

// ── Note row ──────────────────────────────────────────────────────────────────

function FileRow({
  node, selected, depth, actions, onSelect, a11y,
}: {
  node: FileNode;
  selected: boolean;
  depth: number;
  actions: TreeActions;
  onSelect: (path: string) => void;
  a11y: A11yFor;
}) {
  const { onToggleFavorite, isFavorite } = actions;
  const fav = isFavorite?.(node.path) ?? false;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { note } = node;

  // Type and tags used to be pills on the row; in a tree they read as noise,
  // so they live in the tooltip now.
  const meta = [
    note.path,
    note.note_type && note.note_type !== "note" ? note.note_type : null,
    note.tags.length ? note.tags.map((t) => `#${t}`).join(" ") : null,
  ].filter(Boolean).join(" · ");

  return (
    <LeafRow
      id={node.path}
      a11y={a11y}
      depth={depth}
      selected={selected}
      className={menu ? styles.rowContext : ""}
      icon={note.icon ? <span className={styles.emoji}>{note.icon}</span> : <FileIcon />}
      iconTone={note.note_type === "task" ? "accent" : note.note_type === "meeting" ? "agent" : undefined}
      label={node.name}
      hint={isUntitled(note.title) ? relativeTime(note.modified) : undefined}
      title={meta}
      onClick={() => onSelect(node.path)}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", node.path);
        e.dataTransfer.effectAllowed = "move";
      }}
      trailing={onToggleFavorite && (
        <button
          className={`${styles.starBtn} ${fav ? styles.starBtnActive : ""}`}
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(node.path); }}
          title={fav ? "Remove from favorites (f)" : "Add to favorites (f)"}
        >
          {fav ? <StarFilledIcon size={12} /> : <StarIcon size={12} />}
        </button>
      )}
    >
      {menu && (
        <FileContextMenu
          x={menu.x}
          y={menu.y}
          path={node.path}
          fav={fav}
          actions={actions}
          onToggleFavorite={onToggleFavorite}
          onClose={() => setMenu(null)}
        />
      )}
    </LeafRow>
  );
}

// ── Shared row primitives ─────────────────────────────────────────────────────
// Favorites, databases, search results and trash entries render through these
// too, so the whole sidebar has one row height, one icon slot, one hover.

export function LeafRow({
  id, a11y, depth, selected, icon, iconTone, label, hint, title, className, trailing, children,
  onClick, onContextMenu, draggable, onDragStart,
}: {
  id: string;
  a11y: A11yFor;
  depth: number;
  selected?: boolean;
  icon: ReactNode;
  iconTone?: "accent" | "agent";
  label: string;
  /** Secondary, right-aligned hint (an age, a path). */
  hint?: string;
  title?: string;
  className?: string;
  trailing?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  onContextMenu?: (e: ReactMouseEvent<HTMLDivElement>) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      {...a11y(id, selected)}
      className={`${styles.row} ${selected ? styles.rowSelected : ""} ${className ?? ""}`}
      style={rowStyle(depth)}
      title={title}
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      <span className={`${styles.rowIcon} ${iconTone === "accent" ? styles.toneAccent : iconTone === "agent" ? styles.toneAgent : ""}`}>
        {icon}
      </span>
      <span className={styles.label}>{label}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
      {trailing}
      {children}
    </div>
  );
}

/** An expandable row that isn't a folder on disk — a tag, say — drawn with
 *  the folder row's geometry (chevron in the gutter, count on the right) so
 *  it folds like one. The row itself runs `onActivate` (open the tag page);
 *  only the chevron folds, so a click never has to choose between the two. */
export function BranchRow({
  id, a11y, depth, open, hasChildren, icon, label, count, title, onToggle, onActivate, children,
}: {
  id: string;
  a11y: A11yFor;
  depth: number;
  open: boolean;
  hasChildren: boolean;
  icon: ReactNode;
  label: string;
  count: number;
  title?: string;
  onToggle: () => void;
  onActivate: () => void;
  children?: ReactNode;
}) {
  return (
    <div>
      <div
        {...a11y(id)}
        className={`${styles.row} ${styles.dirRow}`}
        style={rowStyle(depth)}
        title={title}
        onClick={onActivate}
      >
        <span
          className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
          style={hasChildren ? undefined : { visibility: "hidden" }}
          aria-hidden
          onClick={(e) => { if (hasChildren) { e.stopPropagation(); onToggle(); } }}
        >
          <ChevronRightIcon size={12} />
        </span>
        <span className={styles.rowIcon}>{icon}</span>
        <span className={styles.dirName}>{label}</span>
        <span className={styles.count}>{count}</span>
      </div>
      {open && hasChildren && <div role="group">{children}</div>}
    </div>
  );
}

/** A quiet one-line row whose whole surface is the action ("No databases · Create one"). */
export function ActionRow({
  id, a11y, depth, icon, text, action, title, onClick,
}: {
  id: string;
  a11y: A11yFor;
  depth: number;
  icon?: ReactNode;
  /** Muted lead-in, e.g. "No databases". */
  text?: string;
  /** The accent-coloured verb, e.g. "Create one". */
  action: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <div
      {...a11y(id)}
      className={`${styles.row} ${styles.actionRow}`}
      style={rowStyle(depth)}
      title={title}
      onClick={onClick}
    >
      <span className={styles.rowIcon}>{icon}</span>
      <span className={styles.label}>
        {text && <span className={styles.actionText}>{text} · </span>}
        <span className={styles.actionVerb}>{action}</span>
      </span>
    </div>
  );
}

// ── Context menu ──────────────────────────────────────────────────────────────

function FileContextMenu({
  x, y, path, fav, actions, onToggleFavorite, onClose,
}: {
  x: number;
  y: number;
  path: string;
  fav: boolean;
  actions: TreeActions;
  onToggleFavorite?: (path: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  // Keep the menu inside the viewport.
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 240);

  const run = (fn?: (p: string) => void) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    onClose();
    fn?.(path);
  };

  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  const revealLabel = isMac ? "Reveal in Finder" : "Show in folder";

  return (
    <div
      ref={ref}
      className={styles.ctxMenu}
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      // The tree's key handler must not see arrows/letters aimed at the menu.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button className={styles.ctxItem} onClick={run(actions.onRenameFile)}>Rename</button>
      <button className={styles.ctxItem} onClick={run(actions.onDuplicateFile)}>Duplicate</button>
      <button className={styles.ctxItem} onClick={run(actions.onTurnIntoDatabase)}>Turn whole note into collection</button>
      {onToggleFavorite && (
        <button className={styles.ctxItem} onClick={run(onToggleFavorite)}>
          {fav ? "Remove from favorites" : "Add to favorites"}
        </button>
      )}
      <button className={styles.ctxItem} onClick={run(actions.onRevealFile)}>{revealLabel}</button>
      <button
        className={styles.ctxItem}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
          const base = path.split("/").pop()?.replace(/\.md$/, "") || "note";
          exportToFile("note-html", path, `${base}.html`);
        }}
      >
        Export to HTML
      </button>
      <button
        className={styles.ctxItem}
        onClick={(e) => { e.stopPropagation(); onClose(); navigator.clipboard?.writeText(path); }}
      >
        Copy path
      </button>
      <div className={styles.ctxSep} />
      <button className={`${styles.ctxItem} ${styles.ctxItemDanger}`} onClick={run(actions.onDeleteFile)}>
        Delete <span className={styles.ctxHint}>Del</span>
      </button>
    </div>
  );
}

// ── New folder input ──────────────────────────────────────────────────────────

function NewFolderInput({
  depth, onSubmit, onCancel,
}: {
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed && !trimmed.includes("/")) onSubmit(trimmed);
  };

  return (
    <div className={`${styles.row} ${styles.newFolderRow}`} style={rowStyle(depth)}>
      <span className={styles.chevron} aria-hidden />
      <span className={styles.rowIcon}><FolderIcon /></span>
      <input
        ref={ref}
        className={styles.newFolderInput}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          // Stop the tree from treating these as navigation keys.
          e.stopPropagation();
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={onCancel}
        placeholder="Folder name…"
      />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countFiles(dir: DirNode): number {
  let n = 0;
  for (const child of dir.children) {
    if (child.type === "file") n++;
    else if (child.type === "dir") n += countFiles(child);
  }
  return n;
}

// Referenced by tooltips so the hint text and the binding can't drift.
export const NEW_NOTE_HINT = `New note (${shortcutFor("new-note")})`;
