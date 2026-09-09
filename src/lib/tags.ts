import type { TagNode } from "./commands";

// Client-side companions to cortex-core's `tags` module. The tree itself comes
// from the backend (`commands.listTags`); these only walk it and mirror the
// one matching rule the core defines, so a tag page can filter the note list
// it already has without another round trip.

/** The tree flattened depth-first — for pickers and counts. */
export function flattenTags(nodes: TagNode[]): TagNode[] {
  const out: TagNode[] = [];
  const walk = (list: TagNode[]) => { for (const n of list) { out.push(n); walk(n.children); } };
  walk(nodes);
  return out;
}

/** The node for a full tag path (`project/alpha`), case-insensitive. */
export function findTag(nodes: TagNode[], path: string): TagNode | null {
  const want = path.toLowerCase();
  return flattenTags(nodes).find((n) => n.path.toLowerCase() === want) ?? null;
}

/** Mirrors `tags::has_tag`: case-insensitive, and a parent matches its
 *  children — `project` matches `project/alpha`. */
export function hasTag(tags: string[], tag: string): boolean {
  const want = tag.replace(/^#/, "").replace(/\/+$/, "").toLowerCase();
  if (!want) return false;
  return tags.some((t) => {
    const lower = t.toLowerCase();
    return lower === want || lower.startsWith(`${want}/`);
  });
}
