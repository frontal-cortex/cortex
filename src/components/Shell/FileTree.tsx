import { useState } from "react";
import { TreeNode, DirNode, FileNode } from "../../lib/fileTree";
import styles from "./FileTree.module.css";

interface Props {
  nodes: TreeNode[];
  selectedPath: string | null;
  defaultOpen?: boolean;
  indent?: number;
  onSelect: (path: string) => void;
}

export function FileTree({ nodes, selectedPath, defaultOpen = true, indent = 0, onSelect }: Props) {
  if (nodes.length === 0) return null;

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
    </div>
  );
}

function DirRow({
  node, selectedPath, defaultOpen, indent, onSelect,
}: {
  node: DirNode;
  selectedPath: string | null;
  defaultOpen: boolean;
  indent: number;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        className={styles.dirRow}
        style={{ paddingLeft: 10 + indent * 14 }}
        onClick={() => setOpen((x) => !x)}
      >
        <span className={`${styles.arrow} ${open ? styles.arrowOpen : ""}`}>▶</span>
        <FolderIcon open={open} />
        <span className={styles.dirName}>{node.name}</span>
        <span className={styles.count}>{countFiles(node)}</span>
      </button>
      {open && (
        <FileTree
          nodes={node.children}
          selectedPath={selectedPath}
          defaultOpen={false}
          indent={indent + 1}
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
      <NoteIcon type={node.note.note_type} />
      <span className={styles.fileName}>{node.name || "Untitled"}</span>
      {node.note.note_type && (
        <span className={styles.noteType}>{node.note.note_type}</span>
      )}
    </button>
  );
}

function countFiles(dir: DirNode): number {
  let n = 0;
  for (const child of dir.children) {
    if (child.type === "file") n++;
    else n += countFiles(child);
  }
  return n;
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={open ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" style={{ opacity: 0.6, flexShrink: 0 }}>
      {open
        ? <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        : <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>}
    </svg>
  );
}

function NoteIcon({ type }: { type: string | null }) {
  // Slight visual variety per type — all are simple document icons
  const color =
    type === "task"    ? "var(--accent)"     :
    type === "journal" ? "var(--git-clean)"  :
    type === "meeting" ? "var(--git-agent)"  :
    "var(--text-tertiary)";

  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" style={{ flexShrink: 0 }}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}
