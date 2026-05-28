import { useState, useEffect, useRef } from "react";
import { TreeNode, DirNode, FileNode } from "../../lib/fileTree";
import styles from "./FileTree.module.css";

interface TreeActions {
  /** Path of the directory currently showing the new-folder input, e.g. "notes/work/" */
  newFolderIn: string | null;
  onNewFolderRequest: (parentPath: string) => void;
  onNewFolderSubmit: (parentPath: string, name: string) => void;
  onNewFolderCancel: () => void;
  onNewNoteInFolder: (parentPath: string) => void;
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
            onSelect={onSelect}
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

  // Auto-open when a child becomes selected
  const hasSelected = selectedPath?.startsWith(node.path);
  useEffect(() => {
    if (hasSelected) setOpen(true);
  }, [hasSelected]);

  return (
    <div>
      <div
        className={styles.dirRow}
        style={{ paddingLeft: 10 + indent * 14 }}
      >
        <button className={styles.dirToggle} onClick={() => setOpen((x) => !x)}>
          <span className={`${styles.arrow} ${open ? styles.arrowOpen : ""}`}>▶</span>
          <FolderIcon open={open} />
          <span className={styles.dirName}>{node.name}</span>
          <span className={styles.count}>{countFiles(node)}</span>
        </button>

        {/* Action buttons — visible on hover via CSS */}
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
        </div>
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
  node, selected, indent, onSelect,
}: {
  node: FileNode;
  selected: boolean;
  indent: number;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      className={`${styles.fileRow} ${selected ? styles.fileRowSelected : ""}`}
      style={{ paddingLeft: 10 + indent * 14 }}
      onClick={() => onSelect(node.path)}
      title={node.path}
    >
      <DocIcon type={node.note.note_type} />
      <span className={styles.fileName}>{node.name || "Untitled"}</span>
      {node.note.note_type && (
        <span className={styles.noteType}>{node.note.note_type}</span>
      )}
    </button>
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
