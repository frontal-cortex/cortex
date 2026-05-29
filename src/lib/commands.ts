import { invoke } from "@tauri-apps/api/core";

export interface VaultInfo {
  path: string;
  name: string;
  has_remote: boolean;
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
}

export interface TrashEntry {
  id: string;
  original_path: string;
  title: string;
  deleted_at: number;
}

export const commands = {
  openVault: (path: string) =>
    invoke<VaultInfo>("open_vault", { path }),

  createVaultFromTemplate: (path: string) =>
    invoke<void>("create_vault_from_template", { path }),

  getVaultInfo: () =>
    invoke<VaultInfo | null>("get_vault_info"),

  listNotes: () =>
    invoke<NoteEntry[]>("list_notes"),

  readNote: (path: string) =>
    invoke<Note>("read_note", { path }),

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
    invoke<void>("git_sync"),

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
