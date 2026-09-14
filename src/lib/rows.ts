// ── Collection rows as notes ─────────────────────────────────────────────────
// Every view opens a row the same way — table, list, tracker, the collection
// page's New button — by asking the shell to open the row's note. Kept out of
// the view components so the tracker (which a view block renders) can use it
// without an import cycle.

/** The note behind a row: `collections/<name>/<id>.md`. Null for a source
 *  that is not a collection (a CSV, a folder of notes). */
export function rowNotePath(source: string, rowId: string): string | null {
  if (!source.startsWith("collections/")) return null;
  return `${source.replace(/\/$/, "")}/${rowId}.md`;
}

/** Open a row as a full note. `focus: "title"` lands in the title with it
 *  selected — how a row that was just made, still called Untitled, gets its
 *  real name by typing. */
export function openRow(source: string, rowId: string, focus: "title" | "body" = "body"): void {
  const path = rowNotePath(source, rowId);
  if (path) window.dispatchEvent(new CustomEvent("cortex:open-note", { detail: { path, focus } }));
}

/** Whether a note is a row of a collection: not the collection's own page
 *  (`_index.md`) and not a row template (`_template-*.md`). */
export function isCollectionRow(path: string): boolean {
  const m = path.match(/^collections\/[^/]+\/([^/]+)\.md$/);
  return !!m && !m[1].startsWith("_");
}
