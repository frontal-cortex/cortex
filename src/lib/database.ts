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
  { type: "chart", label: "Chart" },
];

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
    views.push({
      name: typeof o["name"] === "string" ? (o["name"] as string) : type,
      type: type as ViewType,
      filter: typeof o["filter"] === "string" ? (o["filter"] as string) : undefined,
      sort: asStringArray(o["sort"]),
      columns: asStringArray(o["columns"]),
      group: typeof o["group"] === "string" ? (o["group"] as string) : undefined,
      date: typeof o["date"] === "string" ? (o["date"] as string) : undefined,
      x: typeof o["x"] === "string" ? (o["x"] as string) : undefined,
      y: typeof o["y"] === "string" ? (o["y"] as string) : undefined,
      agg: typeof o["agg"] === "string" ? (o["agg"] as string) : undefined,
      chartType: typeof o["chartType"] === "string" ? (o["chartType"] as string) : undefined,
    });
  }
  return views;
}

/** Strip undefined/empty fields so frontmatter stays tidy. */
export function viewToFrontmatter(v: ViewDef): Record<string, unknown> {
  const o: Record<string, unknown> = { name: v.name, type: v.type };
  if (v.filter) o.filter = v.filter;
  if (v.sort?.length) o.sort = v.sort;
  if (v.columns?.length) o.columns = v.columns;
  if (v.group) o.group = v.group;
  if (v.date) o.date = v.date;
  if (v.x) o.x = v.x;
  if (v.y) o.y = v.y;
  if (v.agg) o.agg = v.agg;
  if (v.chartType) o.chartType = v.chartType;
  return o;
}

/** Build the `cortex-view` YAML spec for a view, injecting the database source.
 *  Mirrors the deterministic format the Rust serializer emits, so the spec can
 *  be fed straight to runView/runChart and round-tripped through ViewToolbar. */
export function specFromView(v: ViewDef, source: string): string {
  let s = `source: ${source}\ntype: ${v.type}\n`;
  if (v.filter) s += `filter: ${v.filter}\n`;
  if (v.sort?.length) s += `sort: [${v.sort.join(", ")}]\n`;
  if (v.columns?.length) s += `columns: [${v.columns.join(", ")}]\n`;
  if (v.group) s += `group: ${v.group}\n`;
  if (v.date) s += `date: ${v.date}\n`;
  if (v.x) s += `x: ${v.x}\n`;
  if (v.y) s += `y: ${v.y}\n`;
  if (v.agg) s += `agg: ${v.agg}\n`;
  if (v.chartType) s += `chartType: ${v.chartType}\n`;
  return s;
}

function specGet(spec: string, key: string): string | undefined {
  return spec.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
}

function specList(spec: string, key: string): string[] | undefined {
  const v = specGet(spec, key);
  if (!v) return undefined;
  const items = v.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

/** Parse a `cortex-view` spec back into a ViewDef, preserving the view's name.
 *  Used when ViewToolbar emits an edited spec. */
export function viewFromSpec(spec: string, name: string): ViewDef {
  return {
    name,
    type: (specGet(spec, "type") as ViewType) ?? "table",
    filter: specGet(spec, "filter"),
    sort: specList(spec, "sort"),
    columns: specList(spec, "columns"),
    group: specGet(spec, "group"),
    date: specGet(spec, "date"),
    x: specGet(spec, "x"),
    y: specGet(spec, "y"),
    agg: specGet(spec, "agg"),
    chartType: specGet(spec, "chartType"),
  };
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
