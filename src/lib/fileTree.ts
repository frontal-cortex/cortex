import { NoteEntry } from "./commands";

export interface FileNode {
  type: "file";
  name: string;
  path: string;
  note: NoteEntry;
}

export interface DirNode {
  type: "dir";
  name: string;
  path: string;   // vault-relative with trailing /
  children: TreeNode[];
}

export type TreeNode = FileNode | DirNode;

/**
 * Build a directory tree from a flat note list plus a list of known
 * directory paths (so empty directories are visible too).
 *
 * @param notes     Flat list of all NoteEntry objects in the vault.
 * @param prefix    Root path for this tree level, e.g. "notes/".
 * @param knownDirs All known directory paths (vault-relative, trailing slash).
 *                  Directories without any .md files are still rendered.
 */
export function buildTree(
  notes: NoteEntry[],
  prefix: string,
  knownDirs: string[] = [],
): TreeNode[] {
  const dirMap = new Map<string, NoteEntry[]>();
  const files: NoteEntry[] = [];

  // Collect notes that belong to this level or deeper
  for (const note of notes) {
    if (!note.path.startsWith(prefix)) continue;
    const rel = note.path.slice(prefix.length);
    const slashIdx = rel.indexOf("/");

    if (slashIdx === -1) {
      files.push(note);
    } else {
      const dirName = rel.slice(0, slashIdx);
      if (!dirMap.has(dirName)) dirMap.set(dirName, []);
      dirMap.get(dirName)!.push(note);
    }
  }

  // Add known empty dirs that are direct children of this prefix
  for (const dirPath of knownDirs) {
    if (!dirPath.startsWith(prefix)) continue;
    const rel = dirPath.slice(prefix.length).replace(/\/$/, "");
    // Only direct children — no slash in the remaining part
    if (!rel || rel.includes("/")) continue;
    if (!dirMap.has(rel)) dirMap.set(rel, []);
  }

  const result: TreeNode[] = [];

  for (const [dirName, dirNotes] of [...dirMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const dirPath = `${prefix}${dirName}/`;
    result.push({
      type: "dir",
      name: dirName,
      path: dirPath,
      children: buildTree(dirNotes, dirPath, knownDirs),
    });
  }

  // Sort by display name (stable) — sorting by mtime made the sidebar reshuffle
  // every time a note was opened or saved. Same-named notes (three "Untitled")
  // fall back to newest-first so the one you just made is on top.
  const named = files.map((note) => ({ note, name: displayTitle(note) }));
  named.sort((a, b) => a.name.localeCompare(b.name) || b.note.modified - a.note.modified);
  for (const { note, name } of named) {
    result.push({ type: "file", name, path: note.path, note });
  }

  return result;
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** A title the user never typed — "Untitled", or nothing at all. */
export function isUntitled(title: string | null | undefined): boolean {
  return !title || /^untitled$/i.test(title.trim());
}

/**
 * What a row calls a note. Untitled notes fall back to the filename stem
 * minus the date suffix `createNote` appends (`untitled-2026-09-07-2` → still
 * "Untitled"); an actual stem ("meeting-notes") reads as "meeting notes".
 * NoteEntry carries no body, so a first-line preview isn't possible here yet —
 * see the "preview" note in LeftPanel.
 */
export function displayTitle(note: Pick<NoteEntry, "title" | "path">): string {
  if (!isUntitled(note.title)) return note.title;
  const stem = pathStem(note.path).replace(/-\d{4}-\d{2}-\d{2}(-\d+)?$/, "");
  return isUntitled(stem) ? "Untitled" : stem.replace(/-/g, " ");
}

/** Compact age for secondary hints: "now", "2m", "3h", "yesterday", "5d". */
export function relativeTime(unixSeconds: number, now = Date.now()): string {
  const d = Math.floor(now / 1000) - unixSeconds;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 172800) return "yesterday";
  return `${Math.floor(d / 86400)}d`;
}

function pathStem(path: string) {
  return path.split("/").pop()?.replace(/\.md$/, "") ?? "";
}

// ── Flattening ────────────────────────────────────────────────────────────────

export interface FlatNode {
  node: TreeNode;
  depth: number;
  /** Path of the enclosing DirNode, or null at the tree's root level. */
  parentPath: string | null;
}

/**
 * The tree in render order, skipping the children of collapsed folders — the
 * list keyboard navigation walks. `isOpen` must be the same predicate the
 * renderer uses, so what the keys see is exactly what is on screen.
 */
export function flattenTree(
  nodes: TreeNode[],
  isOpen: (dirPath: string, depth: number) => boolean,
  depth = 0,
  parentPath: string | null = null,
): FlatNode[] {
  const out: FlatNode[] = [];
  for (const node of nodes) {
    out.push({ node, depth, parentPath });
    if (node.type === "dir" && isOpen(node.path, depth)) {
      out.push(...flattenTree(node.children, isOpen, depth + 1, node.path));
    }
  }
  return out;
}
