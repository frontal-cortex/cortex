// What a vault path is: the small rules for reading a note's place in the
// vault off its path. Kept clear of the command layer so they are tested
// without a host (paths.test.ts).

/** The collection a row note belongs to: `collections/<name>/<id>.md`, where
 *  the file is neither the collection's page (`_index.md`) nor a row template. */
export function rowCollection(path: string): string | null {
  const m = path.match(/^collections\/([^/]+)\/([^/]+)\.md$/);
  return m && !m[2].startsWith("_") ? m[1] : null;
}

/** The collection whose page this is: `collections/<name>/_index.md`. */
export function collectionOfIndex(path: string): string | null {
  return path.match(/^collections\/([^/]+)\/_index\.md$/)?.[1] ?? null;
}
