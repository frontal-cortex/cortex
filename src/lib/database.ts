// Database model — the glue between a collection's `_index.md` and the tabbed
// DatabaseView. A "database" is a `collections/<name>/` folder of row-notes whose
// `_index.md` frontmatter declares its views:
//
//   ---
//   type: database
//   title: Todo
//   icon: ✅
//   views:
//     - name: Table
//       type: table
//       columns: [title, status, due, tags]
//     - name: Board
//       type: board
//       group: status
//   ---
//
// Views are plain structured YAML (human-readable, one small git diff per edit).
// Each view becomes a `cortex-view` spec by injecting the database's `source`, so
// the existing query engine + renderers are reused unchanged.

import { Note, ViewType, ViewDef } from "./commands";

export type { ViewType, ViewDef } from "./commands";

export const VIEW_TYPES: { type: ViewType; label: string }[] = [
  { type: "table", label: "Table" },
  { type: "board", label: "Board" },
  { type: "calendar", label: "Calendar" },
  { type: "gallery", label: "Gallery" },
  { type: "list", label: "List" },
  { type: "chart", label: "Chart" },
  { type: "stats", label: "Stats" },
  { type: "tracker", label: "Tracker" },
  { type: "timeline", label: "Timeline" },
];

/** What a fresh stats view counts: its own rows. */
export const DEFAULT_STATS = '[{"label": "Rows", "agg": "count"}]';

export function isDatabaseNote(note: Note | null): boolean {
  return !!note && note.frontmatter["type"] === "database";
}

export function collectionNameFromIndex(path: string): string | null {
  const m = path.match(/^collections\/([^/]+)\/_index\.md$/);
  return m ? m[1] : null;
}

export function viewSource(collectionName: string): string {
  return `collections/${collectionName}`;
}

/** Sensible starting config for a freshly added view of each type. */
export function defaultViewOfType(type: ViewType, name: string): ViewDef {
  switch (type) {
    case "board": return { name, type, group: "status" };
    case "calendar": return { name, type, date: "created" };
    case "chart": return { name, type, chartType: "line", x: "created", y: "" };
    case "stats": return { name, type, stats: DEFAULT_STATS };
    // The log collection is picked in the view's setup state.
    case "tracker": return { name, type, log: "", date: "date", done: "done", range: "week" };
    // Field names are resolved at render time (`start`/`end`, else the date columns).
    case "timeline": return { name, type };
    default: return { name, type };
  }
}

/** The views a new database starts with. */
export function defaultViews(): ViewDef[] {
  return [
    { name: "Table", type: "table" },
    { name: "Board", type: "board", group: "status" },
  ];
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length ? out : undefined;
}

/** Map-valued keys: a real YAML mapping in `_index.md`, a one-line flow map
 *  (`{amount: sum, done: percent_checked}`) in a spec — the form the Rust
 *  serializer emits, so both round-trip. */
const MAP_KEYS = ["summary"] as const;

/** List-of-maps keys (`stats:`): a real YAML list in `_index.md`, carried in a
 *  ViewDef as JSON text — which is valid YAML flow style, so a spec line
 *  `stats: [{"label": …}]` parses on the Rust side as is. */
const JSON_KEYS = ["stats"] as const;

function jsonList(v: unknown): string | undefined {
  return Array.isArray(v) && v.length ? JSON.stringify(v) : undefined;
}

function parseJsonList(s: string): unknown[] | undefined {
  try { const v = JSON.parse(s); return Array.isArray(v) && v.length ? v : undefined; } catch { return undefined; }
}

function flowMapToObject(s: string): Record<string, string> | undefined {
  const m = s.trim().match(/^\{(.*)\}$/);
  if (!m) return undefined;
  const out: Record<string, string> = {};
  for (const part of m[1].split(",")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function objectToFlowMap(v: unknown): string | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const parts = Object.entries(v as Record<string, unknown>)
    .filter(([k, val]) => k && typeof val === "string" && val !== "")
    .map(([k, val]) => `${k}: ${val}`);
  return parts.length ? `{${parts.join(", ")}}` : undefined;
}

/** Keys with a fixed place in a spec; every other option follows alphabetically. */
const LIST_KEYS = ["sort", "columns"] as const;
const KEY_ORDER = ["filter", "sort", "columns", "group", "bucket", "date", "mode", "limit", "summary", "layout", "size", "x", "y", "agg", "chartType", "series", "stack", "labels", "legend", "height", "log", "done", "range", "start", "end", "stats"];
const orderOf = (k: string) => { const i = KEY_ORDER.indexOf(k); return i < 0 ? KEY_ORDER.length : i; };
const optionKeys = (v: ViewDef) =>
  Object.keys(v).filter((k) => k !== "name" && k !== "type").sort((p, q) => orderOf(p) - orderOf(q) || p.localeCompare(q));

/** Read + validate the views list from an `_index.md`'s frontmatter. */
export function parseViews(frontmatter: Record<string, unknown>): ViewDef[] {
  const raw = frontmatter["views"];
  if (!Array.isArray(raw)) return [];
  const views: ViewDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = o["type"];
    if (typeof type !== "string") continue;
    const v: ViewDef = { name: typeof o["name"] === "string" ? (o["name"] as string) : type, type: type as ViewType };
    for (const [k, val] of Object.entries(o)) {
      if (k === "name" || k === "type") continue;
      if ((LIST_KEYS as readonly string[]).includes(k)) { const arr = asStringArray(val); if (arr) v[k] = arr; }
      else if ((MAP_KEYS as readonly string[]).includes(k)) { const flow = objectToFlowMap(val); if (flow) v[k] = flow; }
      else if ((JSON_KEYS as readonly string[]).includes(k)) { const list = jsonList(val); if (list) v[k] = list; }
      else if (typeof val === "string" && val !== "") v[k] = val;
      else if (typeof val === "number" || typeof val === "boolean") v[k] = String(val);
    }
    views.push(v);
  }
  return views;
}

/** Strip undefined/empty fields so frontmatter stays tidy. */
export function viewToFrontmatter(v: ViewDef): Record<string, unknown> {
  const o: Record<string, unknown> = { name: v.name, type: v.type };
  for (const k of optionKeys(v)) {
    const val = v[k];
    if ((MAP_KEYS as readonly string[]).includes(k) && typeof val === "string") {
      const obj = flowMapToObject(val);
      if (obj) o[k] = obj;
    } else if ((JSON_KEYS as readonly string[]).includes(k) && typeof val === "string") {
      const list = parseJsonList(val);
      if (list) o[k] = list;
    } else if (Array.isArray(val) ? val.length : val) o[k] = val;
  }
  return o;
}

/** Build the `cortex-view` YAML spec for a view, injecting the database source.
 *  Mirrors the deterministic format the Rust serializer emits, so the spec can
 *  be fed straight to runView/runChart and round-tripped through ViewToolbar. */
export function specFromView(v: ViewDef, source: string): string {
  let s = `source: ${source}\ntype: ${v.type}\n`;
  for (const k of optionKeys(v)) {
    const val = v[k];
    if (Array.isArray(val)) { if (val.length) s += `${k}: [${val.join(", ")}]\n`; }
    else if (val) s += `${k}: ${val}\n`;
  }
  return s;
}

function specGet(spec: string, key: string): string | undefined {
  return spec.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
}

/** Parse a `cortex-view` spec back into a ViewDef, preserving the view's name.
 *  Every `key: value` line is kept; sort and columns become lists. */
export function viewFromSpec(spec: string, name: string): ViewDef {
  const v: ViewDef = { name, type: (specGet(spec, "type") as ViewType) ?? "table" };
  for (const line of spec.split("\n")) {
    const m = line.match(/^([A-Za-z_][\w]*):\s*(.+)$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (k === "source" || k === "type") continue;
    const val = raw.trim();
    if ((LIST_KEYS as readonly string[]).includes(k)) {
      const items = val.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean);
      if (items.length) v[k] = items;
    } else if (val) v[k] = val;
  }
  return v;
}

/** Migrate a legacy `_index.md` (views embedded as ```cortex-view fences in the
 *  body) into the frontmatter-views model. Returns the extracted views and the
 *  body with those fences removed (kept as the database description). */
export function migrateLegacyIndex(body: string): { views: ViewDef[]; body: string } {
  const fence = /```cortex-(?:view|chart)\n([\s\S]*?)```/g;
  const views: ViewDef[] = [];
  let m: RegExpExecArray | null;
  let i = 1;
  while ((m = fence.exec(body)) !== null) {
    const spec = m[1];
    const type = (specGet(spec, "type") as ViewType) ?? "table";
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    views.push(viewFromSpec(spec, views.some((v) => v.name === label) ? `${label} ${i}` : label));
    i++;
  }
  // Drop the fences (and any "## Heading" immediately above them) from the body.
  const cleaned = body
    .replace(/(^|\n)#{1,6}[^\n]*\n+```cortex-(?:view|chart)\n[\s\S]*?```/g, "")
    .replace(/```cortex-(?:view|chart)\n[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { views, body: cleaned };
}
