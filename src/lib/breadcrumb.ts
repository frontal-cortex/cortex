// ── Breadcrumb ────────────────────────────────────────────────────────────────
//
// Where the open page sits, the way Notion shows a page's ancestors across the
// top of it. Cortex's hierarchy is the sidebar's: folders under notes/ (or
// templates/), then the databases nested at each level by their page's
// `parent:`, then pages. A database row lives under its database; a database
// under whatever its `parent:` names — another database or a `notes/<folder>`
// path. Nothing here reads the disk: the trail is derived from the note list
// the sidebar already has, so the two always agree.

import type { NoteEntry } from "./commands";
import {
  buildTree, buildCollectionNodes, attachCollections, flattenTree, displayTitle, isUntitled,
  type TreeNode, type ExplorerSort, DEFAULT_SORT,
} from "./fileTree.ts";

export type Crumb =
  /** A folder: `path` is vault-relative with a trailing slash. Not a page,
   *  so the trail offers what is inside it rather than opening it. */
  | { kind: "dir"; label: string; path: string }
  /** A database's page (`collections/<name>/_index.md`). */
  | { kind: "collection"; label: string; path: string; collection: string; icon: string | null }
  /** A note or a database row. */
  | { kind: "note"; label: string; path: string; icon: string | null };

const COLLECTION_PATH = /^collections\/([^/]+)\/(.*)$/;

/** The trail for `path`, root first, ending with the page itself. Empty for no path. */
export function breadcrumbFor(path: string, notes: NoteEntry[]): Crumb[] {
  if (!path) return [];
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const entry = byPath.get(path);

  const m = path.match(COLLECTION_PATH);
  if (m) {
    const [, name, rest] = m;
    const trail = collectionAncestry(name, notes, byPath);
    trail.push(collectionCrumb(name, byPath));
    if (rest !== "_index.md") trail.push(noteCrumb(path, entry));
    return trail;
  }

  const parts = path.split("/");
  const trail: Crumb[] = folderCrumbs(parts.slice(0, -1));
  trail.push(noteCrumb(path, entry));
  return trail;
}

/** Crumbs for a folder chain (`["notes", "work"]` → `notes/work/`). The
 *  notes/ root is home and gets no crumb; other roots (templates/) do. */
function folderCrumbs(folders: string[]): Crumb[] {
  const out: Crumb[] = [];
  for (let i = 1; i <= folders.length; i++) {
    const dirPath = folders.slice(0, i).join("/") + "/";
    if (dirPath === "notes/") continue;
    const name = folders[i - 1];
    const label = i === 1 ? name.charAt(0).toUpperCase() + name.slice(1) : name;
    out.push({ kind: "dir", label, path: dirPath });
  }
  return out;
}

/** What a database nests under, outermost first: the chain of `parent:`
 *  databases, and the folder chain if the outermost names a `notes/` path.
 *  A parent that names nothing known ends the chain; so does a cycle. */
function collectionAncestry(name: string, notes: NoteEntry[], byPath: Map<string, NoteEntry>): Crumb[] {
  const known = new Set<string>();
  for (const n of notes) {
    const m = n.path.match(COLLECTION_PATH);
    if (m) known.add(m[1]);
  }
  const parentOf = (c: string) => (byPath.get(`collections/${c}/_index.md`)?.parent ?? "").trim().replace(/\/$/, "");

  const inner: Crumb[] = [];
  const seen = new Set<string>([name]);
  let cur = parentOf(name);
  while (cur) {
    if (known.has(cur)) {
      if (seen.has(cur)) break;
      seen.add(cur);
      inner.push(collectionCrumb(cur, byPath));
      cur = parentOf(cur);
    } else if (cur === "notes" || cur.startsWith("notes/")) {
      inner.push(...folderCrumbs(cur.split("/")).reverse());
      break;
    } else break;
  }
  return inner.reverse();
}

function collectionCrumb(name: string, byPath: Map<string, NoteEntry>): Crumb {
  const page = byPath.get(`collections/${name}/_index.md`);
  const label = page && !isUntitled(page.title) ? page.title : name.replace(/-/g, " ");
  return { kind: "collection", label, path: `collections/${name}/_index.md`, collection: name, icon: page?.icon ?? null };
}

function noteCrumb(path: string, entry: NoteEntry | undefined): Crumb {
  return { kind: "note", label: displayTitle(entry ?? { title: "", path }), path, icon: entry?.icon ?? null };
}

/**
 * What a folder crumb offers: the folder's children in the sidebar's own
 * order — subfolders, then the databases that nest there, then notes. A root
 * folder (`templates/`) lists its top level; an unknown folder is empty.
 */
export function folderContents(
  dirPath: string,
  notes: NoteEntry[],
  dirs: string[],
  sort: ExplorerSort = DEFAULT_SORT,
): TreeNode[] {
  const root = dirPath.split("/")[0] + "/";
  let tree = buildTree(notes, root, root === "notes/" ? dirs : [], sort);
  if (root === "notes/") {
    const { roots, underFolder } = buildCollectionNodes(notes);
    tree = attachCollections(tree, roots, underFolder);
  }
  if (dirPath === root) return tree;
  const hit = flattenTree(tree, () => true).find(({ node }) => node.type === "dir" && node.path === dirPath);
  return hit && hit.node.type === "dir" ? hit.node.children : [];
}
