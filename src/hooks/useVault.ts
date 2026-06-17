import { useState, useEffect, useCallback } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { commands, VaultInfo, VaultStatus, AgentBranch, CommitEntry, RecentVault, SyncOutcome } from "../lib/commands";

const LOG_LIMIT = 10;

interface VaultState {
  vault: VaultInfo | null;
  recentVaults: RecentVault[];
  status: VaultStatus | null;
  agentBranches: AgentBranch[];
  commits: CommitEntry[];
  syncing: boolean;
  creating: boolean;
  error: string | null;
}

export function useVault() {
  const [state, setState] = useState<VaultState>({
    vault: null,
    recentVaults: [],
    status: null,
    agentBranches: [],
    commits: [],
    syncing: false,
    creating: false,
    error: null,
  });

  useEffect(() => {
    commands.getVaultInfo().then((vault) => {
      if (vault) setState((s) => ({ ...s, vault }));
    });
    commands.getRecentVaults().then((recentVaults) => {
      setState((s) => ({ ...s, recentVaults }));
    });
  }, []);

  // Open a vault by an explicit path (e.g. a recent-vaults entry).
  const openVaultPath = useCallback(async (path: string) => {
    try {
      const vault = await commands.openVault(path);
      setState((s) => ({ ...s, vault, error: null }));
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }));
    }
  }, []);

  const openVault = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;
    await openVaultPath(selected);
  }, [openVaultPath]);

  const createVault = useCallback(async () => {
    const selected = await saveDialog({
      title: "Create new vault",
      defaultPath: "cortex-vault",
    });
    if (!selected) return;
    setState((s) => ({ ...s, creating: true, error: null }));
    try {
      await commands.createVaultFromTemplate(selected);
      const vault = await commands.openVault(selected);
      setState((s) => ({ ...s, vault, creating: false, error: null }));
    } catch (e) {
      setState((s) => ({ ...s, creating: false, error: String(e) }));
    }
  }, []);

  // Leave the current vault and return to the landing page (sign-out style).
  const closeVault = useCallback(async () => {
    try { await commands.closeVault(); } catch { /* clear UI regardless */ }
    const recentVaults = await commands.getRecentVaults().catch(() => []);
    setState((s) => ({
      ...s,
      vault: null,
      status: null,
      agentBranches: [],
      commits: [],
      recentVaults,
      error: null,
    }));
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!state.vault) return;
    try {
      const [status, agentBranches, commits] = await Promise.all([
        commands.gitStatus(),
        commands.listAgentBranches(),
        commands.gitLog(LOG_LIMIT),
      ]);
      setState((s) => ({ ...s, status, agentBranches, commits }));
    } catch {
      // git errors are non-fatal (e.g. fresh repo with no commits yet)
    }
  }, [state.vault]);

  const sync = useCallback(async (): Promise<SyncOutcome | null> => {
    setState((s) => ({ ...s, syncing: true, error: null }));
    try {
      const outcome = await commands.gitSync();
      await refreshStatus();
      return outcome;
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }));
      return null;
    } finally {
      setState((s) => ({ ...s, syncing: false }));
    }
  }, [refreshStatus]);

  const commit = useCallback(
    async (message: string) => {
      await commands.gitCommit(message);
      await refreshStatus();
    },
    [refreshStatus],
  );

  const applyAgentBranch = useCallback(
    async (branchName: string) => {
      await commands.applyAgentBranch(branchName);
      await refreshStatus();
    },
    [refreshStatus],
  );

  const discardAgentBranch = useCallback(
    async (branchName: string) => {
      await commands.discardAgentBranch(branchName);
      await refreshStatus();
    },
    [refreshStatus],
  );

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  return {
    ...state,
    openVault,
    openVaultPath,
    createVault,
    closeVault,
    refreshStatus,
    sync,
    commit,
    applyAgentBranch,
    discardAgentBranch,
  };
}
