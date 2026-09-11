import { invoke } from "@tauri-apps/api/core";

export interface VaultInfo {
  path: string;
  name: string;
  has_remote: boolean;
}

/** Payload of the `vault://changed` event from the Rust filesystem watcher:
 *  what changed on disk outside the app (our own writes are filtered out). */
export interface VaultChanged {
  /** Notes created or modified (vault-relative paths, already re-indexed). */
  notes: string[];
  /** Notes that no longer exist on disk. */
  removed: string[];
  /** Notes whose `.comments.yaml` sidecar changed on disk. */
  comments: string[];
  dirs: boolean;
  config: boolean;
  git: boolean;
}

export interface RecentVault {
  path: string;
  name: string;
  last_opened: number;
}

export type PropType =
  | "text"
  | "number"
  | "date"
  | "checkbox"
  | "select"
  | "multi_select"
  | "status"
  | "url"
  | "person"
  | "relation"
  | "rollup" | "formula"
  /** `{start, end}` under one key; filters compare the end for `<`, the start for `>`, overlap for `within`. */
  | "date_range"
  /** A list of vault-relative file paths (`assets/…`). */
  | "files"
  /** Computed from git history (mtime outside a repo); never written to a row. */
  | "created_time" | "created_by" | "edited_time" | "edited_by";

/** The four git-derived properties, computed on read (`note_authorship`). */
export interface Authorship {
  created_at: string;
  created_by: string;
  edited_at: string;
  edited_by: string;
}

/** A date range property's value as stored: `{start, end?}`. */
export interface DateRange {
  start: string;
  end?: string;
}

export interface Member {
  name: string;
  email: string;
  color: string;
}

export interface CurrentUser {
  name: string;
  email: string;
}

// ── Comments (`<note>.comments.yaml`, see cortex-core comments.rs) ───────────

/** Where a thread points: the nth exact occurrence of `quote` in the body. */
export interface CommentAnchor {
  quote: string;
  /** 0 = the first occurrence. */
  occurrence: number;
}

export interface CommentReply {
  author: string;
  created: string;
  text: string;
}

export interface CommentThread {
  id: string;
  /** Absent for a comment about the whole note. */
  anchor?: CommentAnchor | null;
  author: string;
  /** ISO-8601 UTC. */
  created: string;
  text: string;
  resolved?: boolean;
  replies: CommentReply[];
}

export interface SelectOption {
  name: string;
  color: string;
}

export interface PropertyDef {
  name: string;
  type: PropType;
  options?: SelectOption[];
  /** Relation: target collection. */
  collection?: string;
  /** Rollup: the relation property to follow. */
  relation?: string;
  /** Rollup: the target property to aggregate. */
  property?: string;
  /** Rollup: count | values | sum | avg | min | max. */
  function?: string;
  /** Reverse side: the collection whose rows point at this row via `relation`. */
  from?: string;
  /** Reverse rollup: only rows matching this filter count; `percent` reports their share. */
  where?: string;
  /** Formula expression over the row's own properties (computed on read). */
  expr?: string;
  /** Number display: percent | progress | currency | stars | integer | decimal. */
  format?: string;
  min?: number;
  max?: number;
  /** Currency symbol or unit shown with a number. */
  unit?: string;
  /** Date: stamped with today when this condition holds and the date is empty. */
  auto?: string;
}

/** What a property rename / delete touched. */
export interface PropertyChange {
  rows: number;
  views: number;
  schemas: string[];
  files: string[];
}

export interface TypeSchema {
  properties: PropertyDef[];
}

export interface ClipboardContent {
  kind: "image" | "text" | "none";
  mime: string;
  data_base64: string;
}

export interface ViewColumn {
  key: string;
  ty: "text" | "number" | "bool" | "date" | "list" | "date_range";
  /** Typed-property schema for select/status columns (options + colors). */
  schema?: PropertyDef;
}

export interface FilterClause {
  field: string;
  /** `== != > >= < <= contains does_not_contain starts_with ends_with is_empty is_not_empty within in`. */
  op: string;
  /** Comma-separated for `in`; empty for `is_empty` / `is_not_empty`. */
  value: string;
  /** A parenthesised group: its own clauses and connector (field/op/value unused). */
  clauses?: FilterClause[];
  join?: string;
}

export interface SortClause {
  field: string;
  desc: boolean;
}

export type ViewType = "table" | "board" | "calendar" | "gallery" | "list" | "chart" | "tracker" | "timeline" | "stats";

/** One named view in a database / embedded data block.
 *
 *  Beyond the query keys every view shares (filter, sort, columns, group,
 *  date, limit), a view is a bag of string options its type reads — charts
 *  `x` `y` `agg` `chartType` `bucket` `series`, trackers `log` `done` `range`,
 *  timelines `start` `end`, and field mappings. The parsers and serializers in `database.ts` treat
 *  every option generically, so a new view type or option needs no change
 *  there; the well-known ones are declared here only for editor help. */
export interface ViewDef {
  name: string;
  type: ViewType;
  filter?: string;
  sort?: string[];
  columns?: string[];
  group?: string;
  /** Calendar: the date property. Tracker: the log's date property (default `date`). */
  date?: string;
  /** Calendar: month | week | day (default month). */
  mode?: string;
  limit?: string;
  x?: string;
  y?: string;
  agg?: string;
  chartType?: string;
  /** Chart: fold a date-valued x by day | week | month | quarter | year.
   *  Table / list / board: how a date `group` folds into sections. */
  bucket?: string;
  /** Chart: one series per distinct value of this field. */
  series?: string;
  /** Chart: `true` piles series up (bar/area) instead of side by side. */
  stack?: string;
  /** Chart (donut/pie): slice labels — name | value | name_value | none. */
  labels?: string;
  /** Chart: `false` hides the legend. */
  legend?: string;
  /** Chart: small | medium | large. */
  height?: string;
  /** Gallery: `compact` — no cover, one labelled line per shown property. */
  layout?: string;
  /** Gallery: small | medium | large cards. */
  size?: string;
  /** Stats: the tiles, a JSON list of `{label, agg, field, filter, format}` or `{label, expr}`
   *  (a real YAML list in `_index.md`; `database.ts` converts). */
  stats?: string;
  /** Tracker: the collection with one row per day. */
  log?: string;
  /** Tracker: the log's list property naming the items done (default `done`). */
  done?: string;
  /** Tracker: today | week | month | year. */
  range?: string;
  /** Timeline: the bar's first day (default `start`, else the first date property). */
  start?: string;
  /** Timeline: the bar's last day (default `end`, else the second date property; none = one-day bars).
   *  Calendar: the property that ends a multi-day span (default `end` when the date field is `start`). */
  end?: string;
  /** Table: the summary row as a YAML flow map, `{amount: sum, done: percent_checked}`
   *  (a real mapping in `_index.md` frontmatter; `database.ts` converts). */
  summary?: string;
  /** Any other option a view type defines. */
  [option: string]: string | string[] | undefined;
}

/** An embedded data block's multi-view document (source + named views). */
export interface ViewDoc {
  source: string;
  views: ViewDef[];
}

/** Structured, UI-editable form of a `cortex-view` YAML spec. */
export interface StructuredSpec {
  source: string;
  kind?: string | null;
  filters: FilterClause[];
  filterJoin: string; // "and" | "or"
  filterComplex: boolean;
  filterRaw?: string | null;
  sort: SortClause[];
  columns?: string[] | null;
  group?: string | null;
  date?: string | null;
  limit?: number | null;
  /** Table summary row, field → function. */
  summary?: Record<string, string>;
  /** View-type options (x, chartType, log, range, …), carried through untouched. */
  [option: string]: unknown;
}

export interface ViewRow {
  id: string;
  cells: Record<string, string | number | boolean | string[] | null>;
}

export interface ViewTable {
  name: string;
  columns: ViewColumn[];
  /** All source fields before column projection — for the toolbar's dropdowns. */
  allColumns: string[];
  rows: ViewRow[];
  /** The spec's `summary:` functions evaluated by the engine over `rows`, field → value.
   *  Absent when the spec asks for none. */
  summary?: Record<string, string | number | boolean | string[] | null>;
  /** Which function produced each `summary` value, field → `sum`, …. */
  summaryFunctions?: Record<string, string>;
  /** `group:` sections in display order — option order for a select, newest
   *  first for a date (`bucket:` folds days into weeks, months, quarters or
   *  years) — each with its rows and its own summary. Absent without `group`. */
  groups?: ViewGroup[];
}

/** One `group:` section of a resolved view. */
export interface ViewGroup {
  /** The raw value — a select option, a bucket key (`2026-09`, `2026-Q3`, a week's Monday), or `` for rows without one. */
  key: string;
  /** The heading: `September 2026`, `Week 37 · 8–14 Sep`, `Q3 2026`, `Wed 9 Sep`; the value itself otherwise; `—` for empty. */
  label: string;
  rowIds: string[];
  summary?: Record<string, string | number | boolean | string[] | null>;
}

export interface ChartPoint {
  x: string;
  y: number;
}

export interface ChartSeries {
  name: string;
  points: ChartPoint[];
}

export interface ChartResult {
  chartType: string;
  xLabel: string;
  yLabel: string;
  /** The one series, or with `series:` the per-x sum of all of them. */
  points: ChartPoint[];
  /** Per-value series when the spec sets `series:`; empty otherwise. */
  series: ChartSeries[];
  /** `stack: true` — series pile up (bar/area). */
  stack: boolean;
  /** Slice labels for donut/pie: name | value | name_value | none. */
  labels: string;
  /** `legend: false` hides the legend. */
  legend: boolean;
  /** small | medium | large. */
  height: string;
}

// ── Stats view (see cortex_core::data::run_stats) ──

/** One tile of a `stats` view. */
export interface Stat {
  label: string;
  /** The number, when the result is one; null for text or nothing. */
  value: number | null;
  /** Display text — the number plainly, a date, or `—`. */
  text: string;
  /** `format:` from the entry, else the field's schema format. */
  format?: string;
  /** Why the tile is empty, when its entry could not run. */
  error?: string;
}

export interface StatsResult {
  stats: Stat[];
}

// ── Tracker view (see cortex_core::tracker) ──

/** One item on one day. `free` is a flexible habit's unchecked past day; `off` a day the habit does not ask for. */
export type TrackerCell = "done" | "missed" | "pending" | "free" | "off" | "future";

export interface TrackerItem {
  id: string;
  title: string;
  icon: string | null;
  /** Palette name (gray, blue, …) from the item's category-like select. */
  color: string | null;
  frequency: string;
  /** Days per week asked for: 7 daily, 5 weekdays, the target otherwise. */
  target: number;
  /** Aligned with `TrackerResult.days`. */
  cells: TrackerCell[];
  currentStreak: number;
  longestStreak: number;
  streakUnit: "days" | "weeks";
  weekDone: number;
  rangeDone: number;
  rangeExpected: number;
}

export interface TrackerDay {
  date: string;
  done: number;
  expected: number;
  perfect: boolean;
  logId: string | null;
}

export interface TrackerResult {
  range: string;
  anchor: string;
  start: string;
  end: string;
  today: string;
  logSource: string;
  dateField: string;
  doneField: string;
  items: TrackerItem[];
  days: TrackerDay[];
}

/** A tracker view declared in some collection's `_index.md`. */
export interface TrackerRef {
  collection: string;
  name: string;
  spec: string;
}

export interface NoteRef {
  path: string;
  title: string;
  body: string;
  found: boolean;
}

/** What `rename_note` / `title_changed` did (cortex-core `rename::RenameReport`). */
export interface RenameReport {
  old_path: string;
  new_path: string;
  old_title: string;
  new_title: string;
  /** Notes whose [[links]] were rewritten to follow the rename. */
  rewritten: string[];
  /** True when auto-commit is on and the rename became one commit. */
  committed: boolean;
}

export interface NoteEntry {
  path: string;
  title: string;
  note_type: string | null;
  tags: string[];
  modified: number;
  /** Frontmatter `created:` as written (`YYYY-MM-DD`); null for search hits and notes without one. */
  created: string | null;
  icon: string | null;
  /** `parent:` frontmatter — a collection name or a `notes/<folder>` path the page nests under in the sidebar. */
  parent: string | null;
}

/** One node of the vault's tag tree: `path` is the full tag (`project/alpha`),
 *  `name` its last segment, `count` the notes carrying it or any child. */
export interface TagNode {
  name: string;
  path: string;
  count: number;
  children: TagNode[];
}

/** A search result: the note plus one line of its body around the match,
 *  the matched words wrapped in `<mark>…</mark>` (empty for filter-only queries). */
export interface SearchHit extends NoteEntry {
  snippet: string;
}

/** The sidecar omits defaults (`resolved: false`, `replies: []`, `occurrence: 0`); fill them in. */
function normalizeThreads(threads: CommentThread[]): CommentThread[] {
  return threads.map((t) => ({
    ...t,
    resolved: t.resolved ?? false,
    replies: t.replies ?? [],
    anchor: t.anchor ? { quote: t.anchor.quote, occurrence: t.anchor.occurrence ?? 0 } : null,
  }));
}

// Keys are sorted alphabetically by the Rust BTreeMap — stable YAML output.
export interface Note {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface VaultStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

export interface AgentBranch {
  /** Always `agent/<slug>`, even for a proposal that only exists on origin. */
  name: string;
  description: string;
  commit_count: number;
  /** Exists only on `origin` — pushed by an agent elsewhere; applying creates the local branch. */
  remote: boolean;
}

export interface CommitEntry {
  hash: string;
  message: string;
  author: string;
  timestamp: number;
}

export interface CommitDiff {
  hash: string;
  message: string;
  author: string;
  timestamp: number;
  patch: string;
}

export interface Settings {
  auto_commit: boolean;
  default_note_type: string;
  journal_template: string;
  theme: "light" | "dark" | "system";
  trash_retention_days: number;
  /** Minutes between automatic syncs (plus on-launch and on-focus). 0 = off. */
  auto_sync_minutes: number;
  /** Seconds of typing after which the sidebar steps aside. 0 = never. */
  typing_focus_seconds: number;
  /** Panels slide and controls fade. False = instant. */
  animations: boolean;
  /** Yjs websocket relay for presence + co-editing. Empty = off. */
  collab_url: string;
  /** Palette file to follow (Omarchy `colors.toml` shape). Empty = use `theme`. */
  theme_file: string;
  /** Action colour: empty = the theme's accent; a palette colour name or a #hex. */
  accent: string;
  /** Page typeface: a preset key (see lib/fonts.ts) or a CSS font-family. Empty = default. */
  prose_font: string;
  /** Page tilt: "" upright, degrees ("4", "8"), or "italic". */
  prose_slant: string;
  /** Shortcut overrides: shortcut id → keys (e.g. "mod+shift+b"). See lib/keymap.ts. */
  keybindings: Record<string, string>;
  /** Command run inside the terminal pane when it opens (an agent CLI). Empty = plain shell. */
  terminal_command: string;
  /** Title of the published site. Empty = the vault folder's name. */
  site_title: string;
  /** Published note shown on the site's front page. Empty = list only. */
  site_home: string;
  /** Marketplace index URL. Empty = the official one. */
  marketplace_url: string;
  /** Extra index URLs, comma-separated. */
  marketplace_extra: string;
  /** Tiers shown: official, verified, community (comma-separated). Empty = all. */
  marketplace_tiers: string;
  /** Sidebar tree order: `<name|modified|created|type>-<asc|desc>` (see lib/fileTree.ts). */
  explorer_sort: string;
}

// ── Import (see cortex_core::import) ──

/** How one CSV column lands: the frontmatter key and type. `property` "" skips it. */
export interface ImportColumn {
  header: string;
  property: string;
  type: string;
  options?: string[];
}

export interface ImportSkipped {
  path: string;
  reason: string;
}

export interface CsvImportPlan {
  collection: string;
  exists: boolean;
  title_column: string;
  columns: ImportColumn[];
  rows: number;
  preview: { path: string; frontmatter: Record<string, unknown> }[];
  schema_added: string[];
  schema_exists: boolean;
  skipped: ImportSkipped[];
}

export interface CsvImportReport {
  collection: string;
  written: string[];
  skipped: ImportSkipped[];
  schema_added: string[];
  index_created: boolean;
}

export interface MarkdownImportReport {
  dest: string;
  notes: string[];
  assets: string[];
  skipped: ImportSkipped[];
  unresolved: string[];
}

export interface NotionImportCollection {
  name: string;
  title: string;
  rows: number;
  written: string[];
  schema_added: string[];
  index_created: boolean;
}

export interface NotionImportReport {
  source: string;
  dest: string;
  notes: string[];
  collections: NotionImportCollection[];
  assets: string[];
  skipped: ImportSkipped[];
  unmapped: { subject: string; detail: string }[];
  unresolved: string[];
  report: string | null;
}

/** A note that `publish` would put on the site (see cortex_core::publish). */
export interface PublishEntry {
  path: string;
  title: string;
  /** Site-relative URL, e.g. `notes/ideas/second-brain/`. */
  url: string;
  created: string | null;
  tags: string[];
}

export interface PublishReport {
  out_dir: string;
  pages: PublishEntry[];
  assets: string[];
  removed: string[];
}

export interface PagesPush {
  remote: string;
  remote_url: string;
  branch: string;
  /** Best guess at the public URL for github.com remotes. */
  url: string | null;
  report: PublishReport;
}

// ── Template marketplace (see cortex_core::marketplace, docs/marketplace.md) ──

export type PackKind = "note" | "collection" | "bundle";
export type PackTier = "official" | "verified" | "community";

export interface PackManifest {
  format: number;
  id: string;
  name: string;
  version: string;
  kind: PackKind;
  summary: string;
  description: string;
  tags: string[];
  author: { name: string; url?: string };
  license: string;
  credits?: string;
  min_cortex?: string;
  collection?: string;
  includes?: string[];
  files: string[];
}

/** The shape of a pack at a glance: a template's headings, or a database's columns and views. */
export interface PackExcerpt {
  headings: string[];
  /** [property, type] */
  properties: [string, string][];
  /** [view name, view type] */
  views: [string, string][];
  /** [property, [option, colour][]] for select/status properties */
  options: [string, [string, string][]][];
  /** The collection page's icon, or the first seed's. */
  icon: string | null;
  /** Seed row titles, in file order. */
  seeds: string[];
}

/** One row of the marketplace: the manifest plus where it comes from and its state here. */
export interface PackEntry extends PackManifest {
  tier: PackTier;
  /** `bundled` or the index URL. */
  source: string;
  /** Hero image URL (preview.png, or the first gallery screenshot); null for bundled packs. */
  preview: string | null;
  /** Gallery screenshot URLs, sorted by filename; empty for bundled packs. */
  previews: string[];
  /** Present for bundled packs; null for packs known only from an index. */
  excerpt: PackExcerpt | null;
  installed_version: string | null;
  update_available: boolean;
  needs_newer_app: boolean;
  featured: boolean;
}

export interface PackCatalog {
  entries: PackEntry[];
  /** [index url, error] for sources that could not be fetched; bundled packs still show. */
  errors: [string, string][];
  fetched_at: string | null;
}

export interface Pack {
  manifest: PackManifest;
  tier: PackTier;
  source: string;
  files: { path: string }[];
}

export type PackAction =
  | { action: "write" }
  | { action: "overwrite" }
  | { action: "merge" }
  | { action: "skip"; reason: string };

export interface PackPlan {
  id: string;
  version: string;
  steps: ({ pack_path: string; dest: string } & PackAction)[];
}

export interface PackInstallReport {
  id: string;
  version: string;
  written: string[];
  merged: string[];
  skipped: [string, string][];
}

export interface PackUpdateReport {
  id: string;
  from: string;
  to: string;
  replaced: string[];
  kept: string[];
  added: string[];
}

/** What the pack's page shows, parsed in core from the schema, index and templates. */
export interface PackPreviewOption { name: string; color: string }
export interface PackPreviewProperty {
  name: string;
  /** `text`, `select`, `multi_select`, `relation`, … as written in the schema. */
  type: string;
  format?: string;
  options: PackPreviewOption[];
  /** relation / rollup / formula: a one-line descriptor. */
  detail?: string;
}
export interface PackPreviewView { name: string; type: string }
export interface PackPreviewCollection {
  name: string;
  title?: string;
  icon?: string;
  properties: PackPreviewProperty[];
  views: PackPreviewView[];
  /** The row template's Markdown body, if the pack ships one. */
  template?: string;
  seeds: number;
}
export interface PackPreviewTemplate { path: string; title?: string; body: string }
export interface PackPreview {
  collections: PackPreviewCollection[];
  templates: PackPreviewTemplate[];
  includes: string[];
}

export interface PackRemoveReport {
  id: string;
  removed: string[];
  kept: string[];
}

/** An agent CLI the terminal pane can open into (see cortex_core::agents). */
/** What this build knows about where updates come from (`plugins.updater`
 *  in tauri.conf.json). `configured` is false for a development build, which
 *  has no endpoint or only the placeholder public key. */
export interface UpdateConfig {
  current_version: string;
  endpoint: string | null;
  configured: boolean;
}

export interface AgentCli {
  id: string;
  label: string;
  /** What to run — the value `terminal_command` takes. */
  command: string;
  found: boolean;
  /** Absolute path of the executable, when found. */
  path: string | null;
}

/** A desktop palette: colour name → hex, plus which side of light/dark it is. */
export interface Palette {
  mode: "light" | "dark" | string;
  colors: Record<string, string>;
  /** The desktop theme's name when known (Omarchy's `theme.name`). */
  name?: string | null;
}

/** Result of a sync: clean (did we pull anything?) or a conflicted merge. */
export type SyncOutcome =
  | { status: "ok"; pulled: boolean }
  | { status: "conflicts"; files: string[] };

export interface TrashEntry {
  id: string;
  original_path: string;
  title: string;
  deleted_at: number;
}

/** Payload of `terminal://data`: one chunk of shell output, base64-encoded
 *  because pty bytes are not guaranteed to be valid UTF-8. */
export interface TerminalData {
  id: number;
  data: string;
}

/** Payload of `terminal://exit`: the shell ended on its own (not via kill). */
export interface TerminalExit {
  id: number;
}

/** Mark a successful mutation so the collab layer (when enabled) can nudge
 *  teammates to sync. A plain window event keeps this module dependency-free. */
function touched<T>(p: Promise<T>): Promise<T> {
  return p.then((v) => {
    window.dispatchEvent(new CustomEvent("cortex:local-data-changed"));
    return v;
  });
}

/** What a bookmark card shows (`cortex_core::preview::LinkPreview`). */
export interface LinkPreview {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  site_name?: string;
  fetched_at: number;
  /** Why the fetch failed; the card then shows the bare link. */
  error?: string;
}

/** What a web-embed block loads (`cortex_core::embed::Embed`). */
export interface Embed {
  provider: "youtube" | "vimeo" | "codepen" | "figma" | "maps" | "web";
  src: string;
  aspect: "video" | "page";
  /** Load only after a click (generic pages). */
  shield: boolean;
}

export const commands = {
  runView: (spec: string) =>
    invoke<ViewTable>("run_view", { spec }),

  runChart: (spec: string) =>
    invoke<ChartResult>("run_chart", { spec }),

  /** A `stats` view: one tile per `stats:` entry. Reading only. */
  runStats: (spec: string) =>
    invoke<StatsResult>("run_stats", { spec }),

  // ── Tracker view — reading computes; the only write is a toggle ──
  runTracker: (spec: string, anchor?: string) =>
    invoke<TrackerResult>("run_tracker", { spec, anchor: anchor ?? null }),

  trackerToggle: (logSource: string, dateField: string, doneField: string, date: string, item: string, on?: boolean) =>
    touched(invoke<boolean>("tracker_toggle", { logSource, dateField, doneField, date, item, on: on ?? null })),

  listTrackers: () =>
    invoke<TrackerRef[]>("list_trackers"),

  setCell: (source: string, rowId: string, field: string, value: string, ty: string) =>
    touched(invoke<void>("set_cell", { source, rowId, field, value, ty })),

  addRow: (source: string, id: string, fields: Record<string, string>) =>
    touched(invoke<void>("add_row", { source, id, fields })),

  deleteRow: (source: string, rowId: string) =>
    touched(invoke<void>("delete_row", { source, rowId })),

  /** Copy a row (frontmatter + body) under a new id, created on `created`. */
  duplicateRow: (source: string, rowId: string, newId: string, created: string) =>
    touched(invoke<void>("duplicate_row", { source, rowId, newId, created })),

  listRowTemplates: (source: string) =>
    invoke<string[]>("list_row_templates", { source }),

  /** A row's vault-relative path, created from the collection's row template when it does not exist. */
  ensureRow: (source: string, id: string, fields: Record<string, string>) =>
    touched(invoke<string>("ensure_row", { source, id, fields })),

  addRowFromTemplate: (source: string, id: string, template: string, fields: Record<string, string>) =>
    touched(invoke<void>("add_row_from_template", { source, id, template, fields })),

  saveRowAsTemplate: (source: string, rowId: string, name: string) =>
    invoke<void>("save_row_as_template", { source, rowId, name }),

  listCollections: () =>
    invoke<string[]>("list_collections"),

  /** Move a whole collection to the trash, one restorable entry per file. Returns how many moved. */
  trashCollection: (name: string) =>
    touched(invoke<number>("trash_collection", { name })),

  exportToFile: (kind: "note-html" | "collection-csv" | "collection-html", target: string, dest: string) =>
    invoke<void>("export_to_file", { kind, target, dest }),

  parseViewSpec: (spec: string) =>
    invoke<StructuredSpec>("parse_view_spec", { spec }),

  serializeViewSpec: (spec: StructuredSpec) =>
    invoke<string>("serialize_view_spec", { spec }),

  parseViewDoc: (spec: string) =>
    invoke<ViewDoc>("parse_view_doc", { spec }),

  serializeViewDoc: (doc: ViewDoc) =>
    invoke<string>("serialize_view_doc", { doc }),

  getSchema: (key: string) =>
    invoke<TypeSchema | null>("get_schema", { key }),

  getSchemaForNote: (path: string, noteType: string | null) =>
    invoke<TypeSchema | null>("get_schema_for_note", { path, noteType }),

  setSchema: (key: string, schema: TypeSchema) =>
    invoke<void>("set_schema", { key, schema }),

  upsertProperty: (key: string, property: PropertyDef) =>
    invoke<void>("upsert_property", { key, property }),

  /** Rename a property in the schema, every row, the views and dependent rollups / formulas. */
  renameProperty: (key: string, old: string, next: string) =>
    invoke<PropertyChange>("rename_property", { key, old, new: next }),

  /** Delete a property from the schema, every row and every view; fails while a rollup / formula uses it. */
  deleteProperty: (key: string, name: string) =>
    invoke<PropertyChange>("delete_property", { key, name }),

  getMembers: () =>
    invoke<Member[]>("get_members"),

  setMembers: (members: Member[]) =>
    invoke<void>("set_members", { members }),

  currentUser: () =>
    invoke<CurrentUser>("current_user"),

  // Comments live beside the note, never in it; every write returns the full list.
  listComments: (path: string) =>
    invoke<CommentThread[]>("list_comments", { path }).then(normalizeThreads),

  addComment: (path: string, text: string, anchor: CommentAnchor | null) =>
    invoke<CommentThread[]>("add_comment", { path, text, anchor }).then(normalizeThreads),

  replyComment: (path: string, id: string, text: string) =>
    invoke<CommentThread[]>("reply_comment", { path, id, text }).then(normalizeThreads),

  resolveComment: (path: string, id: string, resolved: boolean) =>
    invoke<CommentThread[]>("resolve_comment", { path, id, resolved }).then(normalizeThreads),

  deleteComment: (path: string, id: string) =>
    invoke<CommentThread[]>("delete_comment", { path, id }).then(normalizeThreads),

  openVault: (path: string) =>
    invoke<VaultInfo>("open_vault", { path }),

  /** Scaffold a vault at `path` — from the bundled tour, or from `template`:
   *  a folder, an `owner/repo` on GitHub, or a git URL (files copied, history not). */
  createVaultFromTemplate: (path: string, template?: string) =>
    invoke<void>("create_vault_from_template", { path, template: template || null }),

  closeVault: () =>
    invoke<void>("close_vault"),

  getVaultInfo: () =>
    invoke<VaultInfo | null>("get_vault_info"),

  getRecentVaults: () =>
    invoke<RecentVault[]>("get_recent_vaults"),

  /** Drop a vault from the recent list (the vault itself is untouched). */
  forgetRecent: (path: string) =>
    invoke<RecentVault[]>("forget_recent", { path }),

  /** The last notes opened in this vault, most recent first (`.brain/ui-state.json`). */
  getRecentNotes: () =>
    invoke<string[]>("get_recent_notes"),

  recordRecentNote: (path: string) =>
    invoke<string[]>("record_recent_note", { path }),

  listNotes: () =>
    invoke<NoteEntry[]>("list_notes"),

  listTags: () =>
    invoke<TagNode[]>("list_tags"),

  readNote: (path: string) =>
    invoke<Note>("read_note", { path }),

  resolveRef: (target: string) =>
    invoke<NoteRef>("resolve_ref", { target }),

  writeNote: (path: string, note: Note) =>
    touched(invoke<void>("write_note", { path, note })),

  createNote: (path: string, title: string, created: string) =>
    invoke<Note>("create_note", { path, title, created }),

  createNoteFromTemplate: (template: string, path: string, vars: Record<string, string>) =>
    invoke<Note>("create_note_from_template", { template, path, vars }),

  deleteNote: (path: string) =>
    invoke<void>("delete_note", { path }),

  /** Full-text search. Operators: `"phrase"`, `-word`, `OR`, `tag:x`, `type:x`, `path:x`. */
  searchNotes: (query: string) =>
    invoke<SearchHit[]>("search_notes", { query }),

  createFolder: (path: string) =>
    invoke<void>("create_folder", { path }),

  deleteFolder: (path: string) =>
    invoke<void>("delete_folder", { path }),

  /** Rename / move a note (and retitle it when `title` is given); every
   *  inbound link is rewritten to follow, one commit when auto-commit is on. */
  renameNote: (oldPath: string, newPath: string, title?: string) =>
    invoke<RenameReport>("rename_note", { oldPath, newPath, title: title ?? null }),

  /** After the editor has saved a new title: point `[[Old Title]]` links at the new one. */
  titleChanged: (path: string, oldTitle: string, newTitle: string) =>
    invoke<RenameReport>("title_changed", { path, oldTitle, newTitle }),

  /** The note a `[[wiki link]]` (any written form) points at — resolved by cortex-core. */
  resolveNote: (target: string) =>
    invoke<NoteEntry | null>("resolve_note", { target }),

  duplicateNote: (path: string) =>
    invoke<string>("duplicate_note", { path }),

  /** Convert a checklist note → database; returns the new index path. */
  convertNoteToDatabase: (path: string, date: string) =>
    invoke<string>("convert_note_to_database", { path, date }),

  /** Convert a database → checklist note; returns the new note path. */
  convertDatabaseToNote: (name: string) =>
    invoke<string>("convert_database_to_note", { name }),

  /** Build a database from selected items; returns its collection name. */
  createDatabaseFromItems: (name: string, items: { text: string; done: boolean }[], date: string) =>
    invoke<string>("create_database_from_items", { name, items, date }),

  revealPath: (path: string) =>
    invoke<void>("reveal_path", { path }),

  moveNote: (fromPath: string, toDir: string) =>
    invoke<string>("move_note", { fromPath, toDir }),

  listVaultDirs: () =>
    invoke<string[]>("list_vault_dirs"),

  saveAsset: (name: string, dataBase64: string) =>
    invoke<string>("save_asset", { name, dataBase64 }),

  readAsset: (relPath: string) =>
    invoke<string>("read_asset", { relPath }),

  /** A bookmark card's data, from `.brain/previews/` or fetched once. A
   *  fetch that failed comes back with `error` set, never as a rejection. */
  fetchLinkPreview: (url: string, refresh = false) =>
    invoke<LinkPreview>("fetch_link_preview", { url, refresh }),

  /** What a web-embed block renders for a URL; null keeps it a link. */
  resolveEmbed: (url: string) =>
    invoke<Embed | null>("resolve_embed", { url }),

  /** The user clicked through a generic embed's shield: its host may load
   *  in a frame for the rest of the session. */
  allowEmbedFrame: (url: string) =>
    invoke<void>("allow_embed_frame", { url }),

  /** The system clipboard as the Rust side sees it (wl-paste / xclip): an image
   *  if there is one, else text. The editor asks when Ctrl+V produced no paste
   *  event — WebKitGTK on Wayland sometimes skips its own paste. */
  readClipboard: () =>
    invoke<ClipboardContent>("read_clipboard"),

  getFavorites: () =>
    invoke<string[]>("get_favorites"),

  setFavorites: (paths: string[]) =>
    invoke<void>("set_favorites", { paths }),

  getSettings: () =>
    invoke<Settings>("get_settings"),

  setSettings: (settings: Settings) =>
    invoke<void>("set_settings", { settings }),

  /** Follow a palette file (empty = stop). Null = no usable file; fall back to `theme`. */
  watchThemeFile: (path: string) =>
    invoke<Palette | null>("watch_theme_file", { path }),

  /** The desktop's own palette file, if this machine has one we recognise. */
  detectDesktopTheme: () =>
    invoke<string | null>("detect_desktop_theme"),

  /** Known agent CLIs (claude, hermes, …) and whether each is on $PATH. */
  detectAgents: () =>
    invoke<AgentCli[]>("detect_agents"),

  /** The update channel compiled into this build; see lib/updater.ts. */
  updateConfig: () =>
    invoke<UpdateConfig>("update_config"),

  // ── Template marketplace — fetch/install only when the user asks ──
  packsCatalog: (refresh: boolean) =>
    invoke<PackCatalog>("packs_catalog", { refresh }),
  packsShow: (id: string, force: boolean) =>
    invoke<[Pack, PackPlan]>("packs_show", { id, force }),
  packsPreview: (id: string) =>
    invoke<PackPreview>("packs_preview", { id }),
  packsInstall: (id: string, force: boolean) =>
    invoke<PackInstallReport[]>("packs_install", { id, force }),
  packsUpdate: (id: string) =>
    invoke<PackUpdateReport>("packs_update", { id }),
  packsRemove: (id: string) =>
    invoke<PackRemoveReport>("packs_remove", { id }),
  packsExport: (id: string, from: string, outDir: string) =>
    invoke<string>("packs_export", { id, from, outDir }),

  // ── Publishing — every call is an explicit user action, never automatic ──
  publishPreview: () =>
    invoke<PublishEntry[]>("publish_preview"),
  publishToDir: (dir: string, force: boolean) =>
    invoke<PublishReport>("publish_to_dir", { dir, force }),
  publishGhPages: (remote: string, branch: string) =>
    invoke<PagesPush>("publish_gh_pages", { remote, branch }),
  publishWriteGithubAction: () =>
    invoke<string>("publish_write_github_action"),

  // ── Import — a plan writes nothing; the import is the user's explicit act ──
  importCsvPlan: (path: string, collection: string, titleColumn: string | null, columns: ImportColumn[] | null) =>
    invoke<CsvImportPlan>("import_csv_plan", { path, collection, titleColumn, columns }),
  importCsv: (path: string, collection: string, titleColumn: string | null, columns: ImportColumn[] | null) =>
    invoke<CsvImportReport>("import_csv", { path, collection, titleColumn, columns }),
  importMarkdown: (path: string, into: string, dryRun: boolean) =>
    invoke<MarkdownImportReport>("import_markdown", { path, into, dryRun }),
  importNotion: (path: string, into: string, dryRun: boolean) =>
    invoke<NotionImportReport>("import_notion", { path, into, dryRun }),

  listTrash: () =>
    invoke<TrashEntry[]>("list_trash"),

  restoreTrashed: (id: string) =>
    invoke<string>("restore_trashed", { id }),

  deleteTrashed: (id: string) =>
    invoke<void>("delete_trashed", { id }),

  emptyTrash: () =>
    invoke<void>("empty_trash"),

  getAllLinks: () =>
    invoke<Array<[string, string]>>("get_all_links"),

  getBacklinks: (path: string) =>
    invoke<NoteEntry[]>("get_backlinks", { path }),

  listTemplates: () =>
    invoke<string[]>("list_templates"),

  readTemplate: (name: string) =>
    invoke<string | null>("read_template", { name }),

  gitStatus: () =>
    invoke<VaultStatus>("git_status"),

  gitCommit: (message: string) =>
    invoke<void>("git_commit", { message }),

  gitSync: () =>
    invoke<SyncOutcome>("git_sync"),

  gitConflicts: () =>
    invoke<string[]>("git_conflicts"),

  gitResolveConflict: (file: string, side: "ours" | "theirs" | "manual") =>
    invoke<void>("git_resolve_conflict", { file, side }),

  gitCompleteMerge: () =>
    invoke<SyncOutcome>("git_complete_merge"),

  gitAbortMerge: () =>
    invoke<void>("git_abort_merge"),

  gitLog: (limit: number) =>
    invoke<CommitEntry[]>("git_log", { limit }),

  gitDiff: (hash: string) =>
    invoke<CommitDiff>("git_diff", { hash }),

  noteHistory: (path: string, limit: number) =>
    invoke<CommitEntry[]>("note_history", { path, limit }),

  /** Created / last edited time and author of one note, from git (mtime outside a repo). */
  noteAuthorship: (path: string) =>
    invoke<Authorship>("note_authorship", { path }),

  noteAt: (path: string, hash: string) =>
    invoke<string>("note_at", { path, hash }),

  restoreNote: (path: string, hash: string) =>
    invoke<Note>("restore_note", { path, hash }),

  listAgentBranches: () =>
    invoke<AgentBranch[]>("list_agent_branches"),

  /** The diff a proposal would apply (merge-base → tip). */
  agentBranchDiff: (branchName: string) =>
    invoke<CommitDiff>("agent_branch_diff", { branchName }),

  applyAgentBranch: (branchName: string) =>
    invoke<void>("apply_agent_branch", { branchName }),

  discardAgentBranch: (branchName: string) =>
    invoke<void>("discard_agent_branch", { branchName }),

  // ── Terminal ──────────────────────────────────────────────────────────────
  // A real pty running the user's shell (see src-tauri/src/terminal.rs).
  // Output arrives on the `terminal://data` event (TerminalData), and
  // `terminal://exit` (TerminalExit) fires once if the shell ends on its own.

  /** Start a shell; `cwd` defaults to the open vault. Returns the session id. */
  terminalSpawn: (cwd: string | undefined, cols: number, rows: number) =>
    invoke<number>("terminal_spawn", { cwd: cwd ?? null, cols, rows }),

  terminalWrite: (id: number, data: string) =>
    invoke<void>("terminal_write", { id, data }),

  terminalResize: (id: number, cols: number, rows: number) =>
    invoke<void>("terminal_resize", { id, cols, rows }),

  /** Kill the shell and drop the session. Safe to call after it exited. */
  terminalKill: (id: number) =>
    invoke<void>("terminal_kill", { id }),
};
