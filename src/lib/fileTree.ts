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

  for (const note of files.sort((a, b) => b.modified - a.modified)) {
    result.push({
      type: "file",
      name: note.title || pathStem(note.path),
      path: note.path,
      note,
    });
  }

  return result;
}

function pathStem(path: string) {
  return path.split("/").pop()?.replace(/\.md$/, "").replace(/-/g, " ") ?? "Untitled";
}
