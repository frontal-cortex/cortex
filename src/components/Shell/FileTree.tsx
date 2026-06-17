import { useState, useEffect, useRef, MouseEvent as ReactMouseEvent } from "react";
import { TreeNode, DirNode, FileNode } from "../../lib/fileTree";
import { exportToFile } from "../../lib/export";
import { StarIcon, StarFilledIcon } from "./icons";
import styles from "./FileTree.module.css";

interface TreeActions {
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
}

interface Props {
  nodes: TreeNode[];
  /** Vault-relative path of this tree level's parent, e.g. "notes/" */
  currentPath: string;
  selectedPath: string | null;
  defaultOpen?: boolean;
  indent?: number;
  actions: TreeActions;
  onSelect: (path: string) => void;
}

export function FileTree({
  nodes, currentPath, selectedPath, defaultOpen = true, indent = 0, actions, onSelect,
}: Props) {
  return (
    <div>
      {nodes.map((node) =>
        node.type === "dir" ? (
          <DirRow
            key={node.path}
            node={node}
            selectedPath={selectedPath}
            defaultOpen={defaultOpen}
            indent={indent}
            actions={actions}
            onSelect={onSelect}
          />
        ) : (
          <FileRow
            key={node.path}
            node={node}
            selected={node.path === selectedPath}
            indent={indent}
            actions={actions}
            onSelect={onSelect}
            onToggleFavorite={actions.onToggleFavorite}
            isFavorite={actions.isFavorite}
          />
        ),
      )}

      {/* Inline new-folder input rendered at this tree level */}
      {actions.newFolderIn === currentPath && (
        <NewFolderInput
          indent={indent}
          onSubmit={(name) => actions.onNewFolderSubmit(currentPath, name)}
          onCancel={actions.onNewFolderCancel}
        />
      )}
    </div>
  );
}

function DirRow({
  node, selectedPath, defaultOpen, indent, actions, onSelect,
}: {
  node: DirNode;
  selectedPath: string | null;
  defaultOpen: boolean;
  indent: number;
  actions: TreeActions;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [dragOver, setDragOver] = useState(false);

  const hasSelected = selectedPath?.startsWith(node.path);
  useEffect(() => {
    if (hasSelected) setOpen(true);
  }, [hasSelected]);

  return (
    <div>
      <div
        className={`${styles.dirRow} ${dragOver ? styles.dirRowDropTarget : ""}`}
        style={{ paddingLeft: 10 + indent * 14 }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={(e) => { e.stopPropagation(); setDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation();
          setDragOver(false);
          const path = e.dataTransfer.getData("text/plain");
          if (path && path !== node.path && !path.startsWith(node.path)) {
            actions.onMoveNote(path, node.path);
          }
        }}
      >
        <button className={styles.dirToggle} onClick={() => setOpen((x) => !x)}>
          <span className={`${styles.arrow} ${open ? styles.arrowOpen : ""}`}>▶</span>
          <FolderIcon open={open} />
          <span className={styles.dirName}>{node.name}</span>
        </button>

        <div className={styles.dirActions}>
          <button
            className={styles.dirActionBtn}
            title="New note here"
            onClick={(e) => { e.stopPropagation(); actions.onNewNoteInFolder(node.path); }}
          >
            <NoteIcon />
          </button>
          <button
            className={styles.dirActionBtn}
            title="New folder here"
            onClick={(e) => { e.stopPropagation(); setOpen(true); actions.onNewFolderRequest(node.path); }}
          >
            <FolderPlusIcon />
          </button>
          <button
            className={`${styles.dirActionBtn} ${styles.dirActionBtnDanger}`}
            title="Delete folder"
            onClick={(e) => { e.stopPropagation(); actions.onDeleteFolder(node.path); }}
          >
            <TrashIcon />
          </button>
        </div>
        <span className={styles.count}>{countFiles(node)}</span>
      </div>

      {open && (
        <FileTree
          nodes={node.children}
          currentPath={node.path}
          selectedPath={selectedPath}
          defaultOpen={false}
          indent={indent + 1}
          actions={actions}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function FileRow({
  node, selected, indent, actions, onSelect, onToggleFavorite, isFavorite,
}: {
  node: FileNode;
  selected: boolean;
  indent: number;
  actions: TreeActions;
  onSelect: (path: string) => void;
  onToggleFavorite?: (path: string) => void;
  isFavorite?: (path: string) => boolean;
}) {
  const fav = isFavorite?.(node.path) ?? false;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <div
      className={`${styles.fileRow} ${selected ? styles.fileRowSelected : ""} ${menu ? styles.fileRowContext : ""}`}
      style={{ paddingLeft: 10 + indent * 14 }}
      onClick={() => onSelect(node.path)}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      title={node.path}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", node.path);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      {node.note.icon
        ? <span className={styles.fileIcon}>{node.note.icon}</span>
        : <DocIcon type={node.note.note_type} />}
      <span className={styles.fileName}>{node.name || "Untitled"}</span>
      {node.note.note_type && node.note.note_type !== "note" && (
        <span className={styles.noteType}>{node.note.note_type}</span>
      )}
      {onToggleFavorite && (
        <button
          className={`${styles.starBtn} ${fav ? styles.starBtnActive : ""}`}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(node.path); }}
          title={fav ? "Remove from favorites" : "Add to favorites"}
        >
          {fav ? <StarFilledIcon size={13} /> : <StarIcon size={13} />}
        </button>
      )}

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
    </div>
  );
}

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
    >
      <button className={styles.ctxItem} onClick={run(actions.onRenameFile)}>Rename</button>
      <button className={styles.ctxItem} onClick={run(actions.onDuplicateFile)}>Duplicate</button>
      <button className={styles.ctxItem} onClick={run(actions.onTurnIntoDatabase)}>Turn whole note into database</button>
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
      <button className={`${styles.ctxItem} ${styles.ctxItemDanger}`} onClick={run(actions.onDeleteFile)}>Delete</button>
    </div>
  );
}

function NewFolderInput({
  indent, onSubmit, onCancel,
}: {
  indent: number;
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
    <div
      className={styles.newFolderRow}
      style={{ paddingLeft: 10 + indent * 14 }}
    >
      <FolderIcon open={false} />
      <input
        ref={ref}
        className={styles.newFolderInput}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
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
    else n += countFiles(child);
  }
  return n;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={open ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth="2" style={{ opacity: 0.55, flexShrink: 0 }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

function DocIcon({ type }: { type: string | null }) {
  const color = type === "task" ? "var(--accent)" : type === "meeting" ? "var(--git-agent)" : "var(--text-tertiary)";
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" style={{ flexShrink: 0 }}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      <line x1="12" y1="11" x2="12" y2="17"/>
      <line x1="9" y1="14" x2="15" y2="14"/>
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
      <line x1="12" y1="11" x2="12" y2="17"/>
      <line x1="9" y1="14" x2="15" y2="14"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );
}
