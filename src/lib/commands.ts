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
}

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

export const commands = {
  openVault: (path: string) =>
    invoke<VaultInfo>("open_vault", { path }),

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

  deleteNote: (path: string) =>
    invoke<void>("delete_note", { path }),

  gitStatus: () =>
    invoke<VaultStatus>("git_status"),

  gitCommit: (message: string) =>
    invoke<void>("git_commit", { message }),

  gitSync: () =>
    invoke<void>("git_sync"),

  listAgentBranches: () =>
    invoke<AgentBranch[]>("list_agent_branches"),

  applyAgentBranch: (branchName: string) =>
    invoke<void>("apply_agent_branch", { branchName }),

  discardAgentBranch: (branchName: string) =>
    invoke<void>("discard_agent_branch", { branchName }),
};
