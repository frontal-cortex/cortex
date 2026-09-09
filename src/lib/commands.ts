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
  | "rollup" | "formula";

export interface Member {
  name: string;
  email: string;
  color: string;
}

export interface CurrentUser {
  name: string;
  email: string;
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

export interface ViewColumn {
  key: string;
  ty: "text" | "number" | "bool" | "date" | "list";
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

export type ViewType = "table" | "board" | "calendar" | "gallery" | "chart" | "tracker" | "timeline";

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
  limit?: string;
  x?: string;
  y?: string;
  agg?: string;
  chartType?: string;
  /** Chart: fold a date-valued x by day | week | month | year. */
  bucket?: string;
  /** Chart: one series per distinct value of this field. */
  series?: string;
  /** Tracker: the collection with one row per day. */
  log?: string;
  /** Tracker: the log's list property naming the items done (default `done`). */
  done?: string;
  /** Tracker: today | week | month | year. */
  range?: string;
  /** Timeline: the bar's first day (default `start`, else the first date property). */
  start?: string;
  /** Timeline: the bar's last day (default `end`, else the second date property; none = one-day bars). */
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

export interface NoteEntry {
  path: string;
  title: string;
  note_type: string | null;
  tags: string[];
  modified: number;
  icon: string | null;
  /** `parent:` frontmatter — a collection name or a `notes/<folder>` path the page nests under in the sidebar. */
  parent: string | null;
}

/** A search result: the note plus one line of its body around the match,
 *  the matched words wrapped in `<mark>…</mark>` (empty for filter-only queries). */
export interface SearchHit extends NoteEntry {
  snippet: string;
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
  preview: string | null;
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

/** A pack file's contents (Markdown / YAML only) and where it lands in the vault. */
export interface PackText {
  path: string;
  dest: string | null;
  text: string | null;
}

export interface PackRemoveReport {
  id: string;
  removed: string[];
  kept: string[];
}

/** An agent CLI the terminal pane can open into (see cortex_core::agents). */
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

export const commands = {
  runView: (spec: string) =>
    invoke<ViewTable>("run_view", { spec }),

  runChart: (spec: string) =>
    invoke<ChartResult>("run_chart", { spec }),

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

  openVault: (path: string) =>
    invoke<VaultInfo>("open_vault", { path }),

  createVaultFromTemplate: (path: string) =>
    invoke<void>("create_vault_from_template", { path }),

  closeVault: () =>
    invoke<void>("close_vault"),

  getVaultInfo: () =>
    invoke<VaultInfo | null>("get_vault_info"),

  getRecentVaults: () =>
    invoke<RecentVault[]>("get_recent_vaults"),

  listNotes: () =>
    invoke<NoteEntry[]>("list_notes"),

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

  renameNote: (oldPath: string, newPath: string) =>
    invoke<void>("rename_note", { oldPath, newPath }),

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

  // ── Template marketplace — fetch/install only when the user asks ──
  packsCatalog: (refresh: boolean) =>
    invoke<PackCatalog>("packs_catalog", { refresh }),
  packsShow: (id: string, force: boolean) =>
    invoke<[Pack, PackPlan]>("packs_show", { id, force }),
  packsFiles: (id: string) =>
    invoke<PackText[]>("packs_files", { id }),
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
