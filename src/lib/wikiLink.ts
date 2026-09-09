/**
 * One `[[wiki link]]`, split into its parts — the TypeScript twin of
 * `cortex_core::note::parse_wiki_link`. The written form is always
 * `[[target#section|alias]]` (section and alias optional); an embed is the
 * same with a leading `!`. Only `target` names a note: navigation, backlinks
 * and the graph match on it alone, `alias` is what the reader sees and
 * `section` is a heading inside the note.
 */
export interface WikiLink {
  target: string;
  alias?: string;
  section?: string;
}

/** Parse the inner text (`Note#Sec|alias`) or the whole `![[…]]` form. */
export function parseWikiLink(raw: string): WikiLink {
  let inner = raw.trim();
  if (inner.startsWith("!")) inner = inner.slice(1);
  if (inner.startsWith("[[")) inner = inner.slice(2);
  if (inner.endsWith("]]")) inner = inner.slice(0, -2);
  const bar = inner.indexOf("|");
  const head = bar === -1 ? inner : inner.slice(0, bar);
  const alias = bar === -1 ? "" : inner.slice(bar + 1).trim();
  const hash = head.indexOf("#");
  const target = (hash === -1 ? head : head.slice(0, hash)).trim();
  const section = hash === -1 ? "" : head.slice(hash + 1).trim();
  const link: WikiLink = { target };
  if (alias) link.alias = alias;
  if (section) link.section = section;
  return link;
}

/** What a reader should see: the alias, else `Target › Section`, else the target. */
export function wikiLinkLabel(link: WikiLink): string {
  if (link.alias) return link.alias;
  if (link.section) return link.target ? `${link.target} › ${link.section}` : link.section;
  return link.target;
}
