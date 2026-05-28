import { NoteEntry } from "./commands";

export interface FileNode {
  type: "file";
  name: string;   // display name (title or filename stem)
  path: string;   // vault-relative path
  note: NoteEntry;
}

export interface DirNode {
  type: "dir";
  name: string;   // folder name
  path: string;   // vault-relative path with trailing /
  children: TreeNode[];
}

export type TreeNode = FileNode | DirNode;

/**
 * Convert a flat NoteEntry list into a directory tree rooted at `prefix`.
 * Dirs are sorted alphabetically; files within each dir are sorted by
 * modified desc (newest first).
 */
export function buildTree(notes: NoteEntry[], prefix: string): TreeNode[] {
  const dirMap = new Map<string, NoteEntry[]>();
  const files: NoteEntry[] = [];

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

  const result: TreeNode[] = [];

  // Dirs first, alphabetical
  for (const [dirName, dirNotes] of [...dirMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const dirPath = prefix + dirName + "/";
    result.push({
      type: "dir",
      name: dirName,
      path: dirPath,
      children: buildTree(dirNotes, dirPath),
    });
  }

  // Then files, newest first
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
