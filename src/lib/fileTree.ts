import type { NoteEntry } from "./commands";

// ── Explorer sort ─────────────────────────────────────────────────────────────
// `explorer_sort` in .cortex/settings.yaml (`<field>-<dir>`), validated by
// cortex-core `settings::parse_explorer_sort`; the same grammar is read here
// so a value written by hand or by `cortex settings set` orders the tree.

export type SortField = "name" | "modified" | "created" | "type";
export type SortDir = "asc" | "desc";
export interface ExplorerSort { field: SortField; dir: SortDir }

export const SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "modified", label: "Modified" },
  { value: "created", label: "Created" },
  { value: "type", label: "Type" },
];
export const DEFAULT_SORT: ExplorerSort = { field: "name", dir: "asc" };

/** `"modified-desc"` → `{ field, dir }`; a bare field is ascending; anything unknown is the default. */
export function parseExplorerSort(raw: string | null | undefined): ExplorerSort {
  const v = (raw ?? "").trim().toLowerCase();
  const m = v.match(/^([a-z]+)(?:-(asc|desc))?$/);
  if (!m || !SORT_FIELDS.some((f) => f.value === m[1])) return DEFAULT_SORT;
  return { field: m[1] as SortField, dir: (m[2] as SortDir | undefined) ?? "asc" };
}

export function formatExplorerSort(sort: ExplorerSort): string {
  return `${sort.field}-${sort.dir}`;
}

/**
 * Order notes for the tree. Name is the tiebreak for every field, so the order
 * is stable across saves (sorting by mtime alone reshuffled the sidebar on
 * every keystroke). Notes without a `created:` sort last either way; for
 * `type`, untyped notes sort last too.
 */
export function sortNotes<T extends { note: NoteEntry; name: string }>(items: T[], sort: ExplorerSort): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name) || b.note.modified - a.note.modified;
  const sign = sort.dir === "desc" ? -1 : 1;
  const missingLast = (a: string | null, b: string | null) => (a === null) === (b === null) ? 0 : a === null ? 1 : -1;
  const cmp = (a: T, b: T): number => {
    switch (sort.field) {
      case "modified": return sign * (a.note.modified - b.note.modified) || byName(a, b);
      case "created": return missingLast(a.note.created, b.note.created) || sign * (a.note.created ?? "").localeCompare(b.note.created ?? "") || byName(a, b);
      case "type": return missingLast(a.note.note_type, b.note.note_type) || sign * (a.note.note_type ?? "").localeCompare(b.note.note_type ?? "") || byName(a, b);
      default: return sign * byName(a, b);
    }
  };
  return [...items].sort(cmp);
}

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

/** A collection's page in the tree. Rows are data and never appear here;
 *  only collections nested under it (`parent: <name>` in their _index.md). */
export interface CollectionNode {
  type: "collection";
  /** Display title from the collection's `_index.md`. */
  name: string;
  /** The page: `collections/<name>/_index.md`. */
  path: string;
  collection: string;
  icon: string | null;
  children: CollectionNode[];
}

export type TreeNode = FileNode | DirNode | CollectionNode;

/**
 * Collections as tree nodes, nested by their page's `parent:`. A parent that
 * names another collection nests there; one that names a `notes/<folder>`
 * path is returned under that folder for `attachCollections`; anything else
 * (absent, unknown, or a cycle) is a root.
 */
export function buildCollectionNodes(notes: NoteEntry[]): { roots: CollectionNode[]; underFolder: Map<string, CollectionNode[]> } {
  const names = new Set<string>();
  for (const n of notes) {
    const m = n.path.match(/^collections\/([^/]+)\//);
    if (m) names.add(m[1]);
  }
  const page = (c: string) => notes.find((n) => n.path === `collections/${c}/_index.md`);
  const nodes = new Map<string, CollectionNode>();
  for (const c of names) {
    const p = page(c);
    nodes.set(c, {
      type: "collection",
      name: p && !isUntitled(p.title) ? p.title : c.replace(/-/g, " "),
      path: `collections/${c}/_index.md`,
      collection: c,
      icon: p?.icon ?? null,
      children: [],
    });
  }
  const parentOf = (c: string) => (page(c)?.parent ?? "").trim().replace(/\/$/, "");
  const isCycle = (c: string) => {
    let cur = parentOf(c);
    for (let i = 0; i < 32 && nodes.has(cur); i++) { if (cur === c) return true; cur = parentOf(cur); }
    return false;
  };
  const roots: CollectionNode[] = [];
  const underFolder = new Map<string, CollectionNode[]>();
  for (const [c, node] of nodes) {
    const parent = parentOf(c);
    if (parent && parent !== c && nodes.has(parent) && !isCycle(c)) nodes.get(parent)!.children.push(node);
    else if (parent.startsWith("notes/") || parent === "notes") {
      const key = parent === "notes" ? "notes/" : `${parent}/`;
      if (!underFolder.has(key)) underFolder.set(key, []);
      underFolder.get(key)!.push(node);
    } else roots.push(node);
  }
  const byName = (a: CollectionNode, b: CollectionNode) => a.name.localeCompare(b.name);
  for (const n of nodes.values()) n.children.sort(byName);
  roots.sort(byName);
  for (const list of underFolder.values()) list.sort(byName);
  return { roots, underFolder };
}

/**
 * Weave collection nodes into a folder tree: at every level, folders first,
 * then the collections that belong there, then notes — the Notion shape of
 * one hierarchy where a database is a page among pages.
 */
export function attachCollections(
  tree: TreeNode[],
  here: CollectionNode[],
  underFolder: Map<string, CollectionNode[]>,
): TreeNode[] {
  const dirs = tree.filter((n): n is DirNode => n.type === "dir").map((d) => ({
    ...d,
    children: attachCollections(d.children, underFolder.get(d.path) ?? [], underFolder),
  }));
  const rest = tree.filter((n) => n.type !== "dir");
  return [...dirs, ...here, ...rest];
}

/**
 * Build a directory tree from a flat note list plus a list of known
 * directory paths (so empty directories are visible too).
 *
 * @param notes     Flat list of all NoteEntry objects in the vault.
 * @param prefix    Root path for this tree level, e.g. "notes/".
 * @param knownDirs All known directory paths (vault-relative, trailing slash).
 *                  Directories without any .md files are still rendered.
 * @param sort      Order of the notes at each level (folders stay A→Z).
 */
export function buildTree(
  notes: NoteEntry[],
  prefix: string,
  knownDirs: string[] = [],
  sort: ExplorerSort = DEFAULT_SORT,
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
      children: buildTree(dirNotes, dirPath, knownDirs, sort),
    });
  }

  // Notes in the explorer's order (name by default). Same-named notes (three
  // "Untitled") fall back to newest-first so the one you just made is on top.
  const named = sortNotes(files.map((note) => ({ note, name: displayTitle(note) })), sort);
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
    const expandable = node.type === "dir" || (node.type === "collection" && node.children.length > 0);
    if (expandable && isOpen(node.path, depth)) {
      out.push(...flattenTree(node.children, isOpen, depth + 1, node.path));
    }
  }
  return out;
}
