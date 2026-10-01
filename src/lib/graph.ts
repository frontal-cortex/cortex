// The graph model behind GraphView: pure functions over the note list and the
// `links` table (`get_all_links`), nothing stored. Link targets are the raw
// wiki-link targets the indexer recorded, so they are resolved here the way
// `vault::resolve` does it — exact path, then title, then filename stem, all
// case-insensitive. Filters reuse the search box's grammar (`search.rs`):
// bare words match the title, `tag:x` / `path:x` / `type:x` match the note,
// and any term can be negated with `-`.
//
// No d3 in here so the model runs under `node --test` (see graph.test.ts);
// the view owns positions and physics.

import type { NoteEntry } from "./commands";
import { hasTag } from "./tags.ts";

/** What drew an edge: a `[[wiki link]]` someone wrote, or a relation property
 *  pointing at another row (an expense's category, a transfer's accounts). */
export type LinkKind = "link" | "relation";

export interface GraphLink {
  source: string;
  target: string;
  kind: LinkKind;
}

export interface GraphNode {
  /** The note path — the node id. */
  id: string;
  title: string;
  icon: string | null;
  tags: string[];
  /** Directory of the note: `notes`, `notes/work`, `collections/tasks`. */
  folder: string;
  /** Links in + out over the whole vault (not just the shown subgraph), so a
   *  hub stays big when the view is filtered down. */
  degree: number;
  /** Hops from the centre in local mode; undefined in global mode. */
  distance?: number;
}

export type GraphMode = "global" | "local";
export type ColorBy = "none" | "tag" | "folder";

export interface GraphOptions {
  mode: GraphMode;
  /** The open note — the centre of the local graph. */
  centre: string | null;
  /** Local mode only: neighbours up to this many hops (1–3). */
  depth: number;
  filter: string;
  showOrphans: boolean;
  /** Draw the edges relation properties make (default true). */
  showRelations?: boolean;
}

export interface GraphModel {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Nodes hidden only by the orphans toggle — for the toolbar count. */
  hiddenOrphans: number;
}

export const MIN_DEPTH = 1;
export const MAX_DEPTH = 3;

export function clampDepth(depth: number): number {
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, Math.round(depth) || MIN_DEPTH));
}

// ── Links ─────────────────────────────────────────────────────────────────────

function stem(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
}

/** Mirror of `vault::resolve`: a lookup from every name a link may use to the
 *  note path. Exact paths win over titles, titles over stems. */
export function linkResolver(notes: NoteEntry[]): (target: string) => string | undefined {
  const byPath = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const byStem = new Map<string, string>();
  for (const n of notes) {
    byPath.set(n.path.toLowerCase(), n.path);
    const title = n.title.trim().toLowerCase();
    if (title && !byTitle.has(title)) byTitle.set(title, n.path);
    const s = stem(n.path).toLowerCase();
    if (s && !byStem.has(s)) byStem.set(s, n.path);
  }
  return (target) => {
    const t = target.trim().toLowerCase();
    if (!t) return undefined;
    return byPath.get(t) ?? byPath.get(`${t}.md`) ?? byTitle.get(t) ?? byStem.get(t);
  };
}

/** Turn `(source path, raw target[, kind])` rows into path→path links:
 *  unresolved targets and self-links are dropped, duplicates collapse to one
 *  edge, and an edge that is both a written link and a relation counts as the
 *  link — the stronger of the two. */
export function resolveLinks(notes: NoteEntry[], raw: Array<[string, string] | [string, string, string]>): GraphLink[] {
  const resolve = linkResolver(notes);
  const known = new Set(notes.map((n) => n.path));
  const at = new Map<string, GraphLink>();
  const out: GraphLink[] = [];
  for (const row of raw) {
    const [source, target] = row;
    const kind: LinkKind = row[2] === "relation" ? "relation" : "link";
    if (!known.has(source)) continue;
    const path = resolve(target);
    if (!path || path === source) continue;
    const key = `${source}\0${path}`;
    const already = at.get(key);
    if (already) { if (kind === "link") already.kind = "link"; continue; }
    const edge: GraphLink = { source, target: path, kind };
    at.set(key, edge);
    out.push(edge);
  }
  return out;
}

// ── Filter grammar ────────────────────────────────────────────────────────────

interface Term {
  field: "title" | "tag" | "path" | "type";
  value: string;
  negated: boolean;
}

/** Tokens split on whitespace, with `"quoted phrases"` kept whole. */
function tokens(text: string): string[] {
  const out: string[] = [];
  const re = /-?(?:[a-z]+:)?"[^"]*"|\S+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

export function parseFilter(text: string): Term[] {
  const terms: Term[] = [];
  for (let tok of tokens(text)) {
    let negated = false;
    if (tok.startsWith("-") && tok.length > 1) { negated = true; tok = tok.slice(1); }
    let field: Term["field"] = "title";
    const colon = tok.indexOf(":");
    if (colon > 0) {
      const key = tok.slice(0, colon).toLowerCase();
      const known: Record<string, Term["field"]> = { tag: "tag", tags: "tag", path: "path", file: "path", type: "type" };
      if (key in known) { field = known[key]; tok = tok.slice(colon + 1); }
    }
    const value = tok.replace(/^"(.*)"$/, "$1").trim().toLowerCase();
    if (!value) continue;
    terms.push({ field, value, negated });
  }
  return terms;
}

export function matchesFilter(note: NoteEntry, terms: Term[]): boolean {
  for (const t of terms) {
    let hit: boolean;
    switch (t.field) {
      case "tag": hit = hasTag(note.tags, t.value); break;
      case "path": hit = note.path.toLowerCase().includes(t.value); break;
      case "type": hit = (note.note_type ?? "").toLowerCase() === t.value; break;
      default: hit = displayTitle(note).toLowerCase().includes(t.value) || stem(note.path).toLowerCase().includes(t.value);
    }
    if (hit === t.negated) return false;
  }
  return true;
}

// ── Model ─────────────────────────────────────────────────────────────────────

export function displayTitle(n: NoteEntry): string {
  return n.title || stem(n.path);
}

export function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** The nodes and edges to draw for these options. Global mode is every note
 *  passing the filter; local mode walks `depth` hops out from the centre
 *  through notes passing the filter (the centre itself always shows). With
 *  orphans off, nodes with no edge in the shown graph are dropped. */
export function buildGraph(notes: NoteEntry[], rawLinks: Array<[string, string] | [string, string, string]>, opts: GraphOptions): GraphModel {
  const all = resolveLinks(notes, rawLinks);
  // Relations can be switched off: what a database relates is most of the
  // edges in a vault that keeps one, and sometimes you want only what you wrote.
  const links = opts.showRelations === false ? all.filter((l) => l.kind === "link") : all;
  const degree = new Map<string, number>();
  const adj = new Map<string, Set<string>>();
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    if (!adj.has(l.source)) adj.set(l.source, new Set());
    if (!adj.has(l.target)) adj.set(l.target, new Set());
    adj.get(l.source)!.add(l.target);
    adj.get(l.target)!.add(l.source);
  }

  const terms = parseFilter(opts.filter);
  const centre = opts.mode === "local" && opts.centre && notes.some((n) => n.path === opts.centre) ? opts.centre : null;
  const allowed = new Set<string>();
  for (const n of notes) if (n.path === centre || matchesFilter(n, terms)) allowed.add(n.path);

  let distance: Map<string, number> | null = null;
  if (centre) {
    distance = new Map([[centre, 0]]);
    let frontier = [centre];
    const depth = clampDepth(opts.depth);
    for (let d = 1; d <= depth && frontier.length; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of adj.get(id) ?? []) {
          if (!allowed.has(nb) || distance.has(nb)) continue;
          distance.set(nb, d);
          next.push(nb);
        }
      }
      frontier = next;
    }
  }

  const kept = new Set<string>();
  for (const id of allowed) if (!distance || distance.has(id)) kept.add(id);
  const shownLinks = links.filter((l) => kept.has(l.source) && kept.has(l.target));

  let hiddenOrphans = 0;
  if (!opts.showOrphans) {
    const linked = new Set<string>();
    for (const l of shownLinks) { linked.add(l.source); linked.add(l.target); }
    for (const id of [...kept]) {
      if (!linked.has(id) && id !== centre) { kept.delete(id); hiddenOrphans++; }
    }
  }

  const nodes: GraphNode[] = notes
    .filter((n) => kept.has(n.path))
    .map((n) => ({
      id: n.path,
      title: displayTitle(n),
      icon: n.icon,
      tags: n.tags,
      folder: folderOf(n.path),
      degree: degree.get(n.path) ?? 0,
      distance: distance?.get(n.path),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return { nodes, links: shownLinks, hiddenOrphans };
}

// ── Colouring ─────────────────────────────────────────────────────────────────

/** The palette names from colors.ts that colour nodes; gray is reserved for
 *  "no key" so an untagged note reads as neutral. */
export const NODE_COLORS = ["blue", "green", "orange", "purple", "pink", "red", "yellow", "brown"] as const;
export type NodeColor = (typeof NODE_COLORS)[number] | "gray";

export interface LegendEntry {
  key: string;
  color: NodeColor;
  count: number;
}

/** What a node is coloured by: its first tag, or its folder. Empty = none. */
export function colorKey(node: GraphNode, by: ColorBy): string {
  if (by === "tag") return node.tags[0] ?? "";
  if (by === "folder") return node.folder;
  return "";
}

/** Keys ranked by how many shown nodes carry them, each with a palette colour
 *  (wrapping past the palette — the legend still lists every key). */
export function buildLegend(nodes: GraphNode[], by: ColorBy): LegendEntry[] {
  if (by === "none") return [];
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const k = colorKey(n, by);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count], i) => ({ key, count, color: NODE_COLORS[i % NODE_COLORS.length] }));
}

export function colorOf(node: GraphNode, by: ColorBy, legend: LegendEntry[]): NodeColor {
  const k = colorKey(node, by);
  return legend.find((e) => e.key === k)?.color ?? "gray";
}

/** Which nodes keep their name on screen. Three hundred labels at once are a
 *  grey smear; the best-connected ones say what a cluster is, and zooming in
 *  brings the rest back — at full zoom every node is named. `centre` (the
 *  local graph's middle) is always named.
 *
 *  Returns the smallest degree a node needs to be labelled, or 0 for all. */
export function labelFloor(nodeCount: number, scale: number): number {
  // Room for about forty labels at rest, and more as the view zooms in, since
  // fewer nodes are on screen to crowd them.
  const room = 40 * Math.pow(Math.max(0.2, scale), 1.5);
  if (nodeCount <= room) return 0;
  return Math.max(1, Math.ceil(Math.log2(nodeCount / room)) + 1);
}

/** Node radius from its link count: 7px for a leaf, growing with the square
 *  root so a hub is visibly bigger without swallowing its neighbours. */
export function nodeRadius(degree: number): number {
  return Math.min(24, 7 + Math.sqrt(degree) * 3);
}
