// ── Buttons ──────────────────────────────────────────────────────────────────
// A button is a fenced block on disk:
//
//     ```cortex-button
//     label: New expense
//     action: add-row
//     collection: budget
//     values: {kind: expense, date: "{{today}}"}
//     open: true
//     ```
//
// One action each, and every action is an operation the palette or the CLI
// already has — a button is a person pressing it, never a timer. This module
// is the pure part: the spec's on-disk form, placeholder expansion, and the
// dispatch of an action against injected dependencies (so it is testable
// without the app). The block component and the palette call `runButton`.

export type ButtonAction = "add-row" | "open" | "log" | "set" | "url";

export const BUTTON_ACTIONS: ButtonAction[] = ["add-row", "open", "log", "set", "url"];

export interface ButtonSpec {
  label: string;
  action: ButtonAction;
  /** add-row / log / open: the collection (folder name under collections/). */
  collection?: string;
  /** add-row: property values for the new row; set: values written to the current row. */
  values?: Record<string, string>;
  /** add-row: a row template name (without `_template-` / `.md`). */
  template?: string;
  /** add-row: open the new row when it exists. */
  open?: boolean;
  /** open: a note path or title. */
  target?: string;
  /** open: a view name to switch to on the collection's page. */
  view?: string;
  /** log: the tracker item to tick for today. */
  item?: string;
  /** url: http(s) or mailto. */
  url?: string;
}

const KNOWN_KEYS = ["label", "action", "collection", "values", "template", "open", "target", "view", "item", "url"];

function unquote(v: string): string {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

/** `{a: 1, b: "two words"}` → map. Commas inside quotes are kept. */
function parseFlowMap(s: string): Record<string, string> {
  const inner = s.trim().replace(/^\{/, "").replace(/\}$/, "");
  const out: Record<string, string> = {};
  let cur = ""; let quote: string | null = null;
  const parts: string[] = [];
  for (const ch of inner) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === ",") { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) {
    const i = p.indexOf(":");
    if (i < 0) continue;
    const k = p.slice(0, i).trim(); const v = unquote(p.slice(i + 1));
    if (k) out[k] = v;
  }
  return out;
}

/** The fence text → spec. A small YAML subset: `key: value` lines, `values:`
 *  as a flow map or an indented block map, quoted or bare scalars. Unknown
 *  keys are kept out; `unknownKeys` reports them for lint-style warnings. */
export function parseButtonSpec(text: string): { spec: ButtonSpec; unknownKeys: string[] } {
  const spec: ButtonSpec = { label: "", action: "add-row" };
  const unknown: string[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s/.test(line)) continue; // continuation lines are consumed by `values:` below
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]; const raw = m[2];
    if (key === "values") {
      if (raw.trim().startsWith("{")) { spec.values = parseFlowMap(raw); continue; }
      const map: Record<string, string> = {};
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        i++;
        const mm = lines[i].trim().match(/^([^:]+):\s*(.*)$/);
        if (mm) map[mm[1].trim()] = unquote(mm[2]);
      }
      spec.values = map;
      continue;
    }
    const v = unquote(raw);
    switch (key) {
      case "label": spec.label = v; break;
      case "action": spec.action = (BUTTON_ACTIONS.includes(v as ButtonAction) ? v : v) as ButtonAction; break;
      case "collection": spec.collection = v.replace(/^collections\//, "").replace(/\/$/, ""); break;
      case "template": spec.template = v; break;
      case "open": spec.open = v === "true" || v === "yes"; break;
      case "target": spec.target = v; break;
      case "view": spec.view = v; break;
      case "item": spec.item = v; break;
      case "url": spec.url = v; break;
      default: if (!KNOWN_KEYS.includes(key)) unknown.push(key);
    }
  }
  return { spec, unknownKeys: unknown };
}

function quoteIfNeeded(v: string): string {
  return /[:#{}\[\],&*?|<>=!%@`"']|^\s|\s$|^$/.test(v) || /^(true|false|yes|no|null|~)$/i.test(v) || /^-?\d/.test(v)
    ? `"${v.replace(/"/g, '\\"')}"`
    : v;
}

/** Spec → the fence text, keys in a fixed order so diffs stay quiet. */
export function serializeButtonSpec(spec: ButtonSpec): string {
  const lines: string[] = [`label: ${quoteIfNeeded(spec.label)}`, `action: ${spec.action}`];
  if (spec.collection) lines.push(`collection: ${spec.collection}`);
  if (spec.target) lines.push(`target: ${quoteIfNeeded(spec.target)}`);
  if (spec.item) lines.push(`item: ${quoteIfNeeded(spec.item)}`);
  if (spec.url) lines.push(`url: ${spec.url}`);
  if (spec.template) lines.push(`template: ${quoteIfNeeded(spec.template)}`);
  if (spec.values && Object.keys(spec.values).length) {
    lines.push(`values: {${Object.entries(spec.values).map(([k, v]) => `${k}: ${quoteIfNeeded(v)}`).join(", ")}}`);
  }
  if (spec.view) lines.push(`view: ${quoteIfNeeded(spec.view)}`);
  if (spec.open) lines.push("open: true");
  return lines.join("\n") + "\n";
}

const pad = (n: number) => String(n).padStart(2, "0");
export function isoDate(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** `{{today}}`, `{{today+7}}`, `{{date}}`, `{{time}}` in a value, relative to `now`.
 *  Other placeholders are left for the row template to expand. */
export function expandPlaceholders(value: string, now: Date = new Date()): string {
  return value.replace(/\{\{\s*(today|date)(?:\s*([+-])\s*(\d+))?\s*\}\}/gi, (_, __, sign, n) => {
    const d = new Date(now);
    if (sign) d.setDate(d.getDate() + (sign === "-" ? -1 : 1) * Number(n));
    return isoDate(d);
  }).replace(/\{\{\s*time\s*\}\}/gi, `${pad(now.getHours())}:${pad(now.getMinutes())}`);
}

export function expandValues(values: Record<string, string> | undefined, now: Date = new Date()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values ?? {})) out[k] = expandPlaceholders(v, now);
  return out;
}

/** One line for the palette and tooltips. */
export function describeButton(spec: ButtonSpec): string {
  switch (spec.action) {
    case "add-row": return `Add a row to ${spec.collection ?? "?"}${spec.template ? ` from ${spec.template}` : ""}${spec.open ? ", then open it" : ""}`;
    case "open": return spec.collection ? `Open ${spec.collection}${spec.view ? ` · ${spec.view}` : ""}` : `Open ${spec.target ?? "?"}`;
    case "log": return `Tick ${spec.item ?? "?"} today in ${spec.collection ?? "?"}`;
    case "set": return `Set ${Object.entries(spec.values ?? {}).map(([k, v]) => `${k} = ${v}`).join(", ") || "?"} on this row`;
    case "url": return spec.url ?? "?";
  }
}

/** What a button touches, so the component and the palette share one path. */
export interface ButtonDeps {
  addRow(source: string, id: string, fields: Record<string, string>): Promise<void>;
  addRowFromTemplate(source: string, id: string, template: string, fields: Record<string, string>): Promise<void>;
  setCell(source: string, rowId: string, field: string, value: string): Promise<void>;
  /** The tracker views in the vault: collection, view name, and the view's YAML spec. */
  listTrackers(): Promise<{ collection: string; name: string; spec: string }[]>;
  trackerToggle(logSource: string, dateField: string, doneField: string, date: string, item: string): Promise<void>;
  resolveNote(target: string): Promise<string | null>;
  openNote(path: string, view?: string): void;
  openExternal(url: string): Promise<boolean>;
  now?: () => Date;
  newId?: () => string;
}

export function newRowId(): string {
  return `row-${Date.now().toString(36)}`;
}

/** The current row when the note is one: `collections/<c>/<id>.md`, not the collection page. */
export function rowOf(notePath: string): { source: string; id: string } | null {
  const m = notePath.match(/^collections\/([^/]+)\/([^/]+)\.md$/);
  if (!m || m[2].startsWith("_")) return null;
  return { source: `collections/${m[1]}`, id: m[2] };
}

function peek(spec: string, key: string): string | undefined {
  const m = spec.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m?.[1]?.trim().replace(/^["']|["']$/g, "");
}

/** Run a button. Resolves with a short message for the UI; throws with a
 *  reason a person can act on. */
export async function runButton(spec: ButtonSpec, notePath: string, deps: ButtonDeps): Promise<string> {
  const now = deps.now?.() ?? new Date();
  switch (spec.action) {
    case "add-row": {
      if (!spec.collection) throw new Error("This button names no collection.");
      const source = `collections/${spec.collection}`;
      const id = (deps.newId ?? newRowId)();
      const fields = expandValues(spec.values, now);
      if (spec.template) await deps.addRowFromTemplate(source, id, spec.template, fields);
      else await deps.addRow(source, id, { title: "Untitled", created: isoDate(now), ...fields });
      if (spec.open) deps.openNote(`${source}/${id}.md`);
      return `Added a row to ${spec.collection}`;
    }
    case "open": {
      if (spec.collection) { deps.openNote(`collections/${spec.collection}/_index.md`, spec.view); return `Opened ${spec.collection}`; }
      if (!spec.target) throw new Error("This button names nothing to open.");
      const isPath = spec.target.includes("/") || spec.target.endsWith(".md");
      const path = isPath ? spec.target : await deps.resolveNote(spec.target);
      if (!path) throw new Error(`No note titled "${spec.target}".`);
      deps.openNote(path, spec.view);
      return `Opened ${spec.target}`;
    }
    case "log": {
      if (!spec.collection || !spec.item) throw new Error("A log button needs a collection and an item.");
      const trackers = (await deps.listTrackers()).filter((t) => t.collection === spec.collection);
      const t = trackers[0];
      if (!t) throw new Error(`${spec.collection} has no tracker view to log into.`);
      const log = peek(t.spec, "log") ?? `collections/${spec.collection}-log`;
      await deps.trackerToggle(log, peek(t.spec, "date") ?? "date", peek(t.spec, "done") ?? "done", isoDate(now), spec.item);
      return `Logged ${spec.item} for today`;
    }
    case "set": {
      const row = rowOf(notePath);
      if (!row) throw new Error("Set works on a collection row's page; this is not one.");
      const values = expandValues(spec.values, now);
      if (!Object.keys(values).length) throw new Error("This button sets nothing.");
      for (const [k, v] of Object.entries(values)) await deps.setCell(row.source, row.id, k, v);
      return `Set ${Object.keys(values).join(", ")}`;
    }
    case "url": {
      if (!spec.url) throw new Error("This button has no URL.");
      const ok = await deps.openExternal(spec.url);
      if (!ok) throw new Error("Only http, https and mailto links open from a button.");
      return `Opened ${spec.url}`;
    }
    default:
      throw new Error(`Unknown button action "${(spec as ButtonSpec).action}". Known: ${BUTTON_ACTIONS.join(", ")}.`);
  }
}

// ── The open note's buttons, for the palette ────────────────────────────────

/** `cortexButton` blocks anywhere in a document, in reading order. */
export function collectButtons(blocks: any[]): ButtonSpec[] {
  const out: ButtonSpec[] = [];
  const walk = (bs: any[]) => {
    for (const b of bs ?? []) {
      if (b?.type === "cortexButton") out.push(parseButtonSpec(String(b.props?.spec ?? "")).spec);
      if (Array.isArray(b?.children) && b.children.length) walk(b.children);
    }
  };
  walk(blocks);
  return out.filter((b) => b.label);
}

let noteButtons: { path: string; buttons: ButtonSpec[] } = { path: "", buttons: [] };
const listeners = new Set<() => void>();

export function setNoteButtons(path: string, buttons: ButtonSpec[]): void {
  noteButtons = { path, buttons };
  for (const l of listeners) l();
}
export function getNoteButtons(): { path: string; buttons: ButtonSpec[] } { return noteButtons; }
export function subscribeNoteButtons(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
