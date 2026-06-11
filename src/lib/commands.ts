import { invoke } from "@tauri-apps/api/core";

export interface VaultInfo {
  path: string;
  name: string;
  has_remote: boolean;
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
  | "person";

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
  options: SelectOption[];
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
  op: string;
  value: string;
}

export interface SortClause {
  field: string;
  desc: boolean;
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
  x?: string | null;
  y?: string | null;
  agg?: string | null;
  chartType?: string | null;
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
}

export interface ChartPoint {
  x: string;
  y: number;
}

export interface ChartResult {
  chartType: string;
  xLabel: string;
  yLabel: string;
  points: ChartPoint[];
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
  name: string;
  description: string;
  commit_count: number;
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

export const commands = {
  runView: (spec: string) =>
    invoke<ViewTable>("run_view", { spec }),

  runChart: (spec: string) =>
    invoke<ChartResult>("run_chart", { spec }),

  setCell: (source: string, rowId: string, field: string, value: string, ty: string) =>
    invoke<void>("set_cell", { source, rowId, field, value, ty }),

  addRow: (source: string, id: string, fields: Record<string, string>) =>
    invoke<void>("add_row", { source, id, fields }),

  deleteRow: (source: string, rowId: string) =>
    invoke<void>("delete_row", { source, rowId }),

  parseViewSpec: (spec: string) =>
    invoke<StructuredSpec>("parse_view_spec", { spec }),

  serializeViewSpec: (spec: StructuredSpec) =>
    invoke<string>("serialize_view_spec", { spec }),

  getSchema: (key: string) =>
    invoke<TypeSchema | null>("get_schema", { key }),

  getSchemaForNote: (path: string, noteType: string | null) =>
    invoke<TypeSchema | null>("get_schema_for_note", { path, noteType }),

  setSchema: (key: string, schema: TypeSchema) =>
    invoke<void>("set_schema", { key, schema }),

  upsertProperty: (key: string, property: PropertyDef) =>
    invoke<void>("upsert_property", { key, property }),

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
    invoke<void>("write_note", { path, note }),

  createNote: (path: string, title: string, created: string) =>
    invoke<Note>("create_note", { path, title, created }),

  createNoteFromTemplate: (template: string, path: string, vars: Record<string, string>) =>
    invoke<Note>("create_note_from_template", { template, path, vars }),

  deleteNote: (path: string) =>
    invoke<void>("delete_note", { path }),

  searchNotes: (query: string) =>
    invoke<NoteEntry[]>("search_notes", { query }),

  createFolder: (path: string) =>
    invoke<void>("create_folder", { path }),

  deleteFolder: (path: string) =>
    invoke<void>("delete_folder", { path }),

  renameNote: (oldPath: string, newPath: string) =>
    invoke<void>("rename_note", { oldPath, newPath }),

  duplicateNote: (path: string) =>
    invoke<string>("duplicate_note", { path }),

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

  applyAgentBranch: (branchName: string) =>
    invoke<void>("apply_agent_branch", { branchName }),

  discardAgentBranch: (branchName: string) =>
    invoke<void>("discard_agent_branch", { branchName }),
};
