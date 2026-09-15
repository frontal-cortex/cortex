import { useState, useEffect, useCallback } from "react";
import { isDesktop } from "../lib/transport";
import { loadCapabilities } from "../lib/host";
import type { ServedGate } from "../components/PairScreen/PairScreen";
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
  /** True until we know whether there's a vault to reopen — avoids flashing the picker. */
  booting: boolean;
  /** Served to a browser: what stands between it and the vault, if anything. */
  served: ServedGate | null;
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
    booting: true,
    served: null,
    error: null,
  });

  // Served to a browser, the server has already opened its vault: ask whether
  // this browser may use it, then go straight in. There is no picker there.
  const bootServed = useCallback(async () => {
    const caps = await loadCapabilities().catch(() => null);
    if (!caps) {
      setState((s) => ({ ...s, booting: false, served: "unreachable" }));
      return;
    }
    if (!caps.authenticated) {
      setState((s) => ({ ...s, booting: false, served: "pair" }));
      return;
    }
    const vault = await commands.getVaultInfo().catch(() => null);
    setState((s) => ({ ...s, vault, booting: false, served: vault ? null : "no-vault" }));
  }, []);

  useEffect(() => {
    if (!isDesktop()) {
      void bootServed();
      // Any request refused mid-session (a revoked login, a changed code) sends
      // the browser back to the front door.
      const onAuth = () => setState((s) => ({ ...s, vault: null, served: "pair" }));
      window.addEventListener("cortex:served-auth", onAuth);
      return () => window.removeEventListener("cortex:served-auth", onAuth);
    }
    (async () => {
      const recentVaults = await commands.getRecentVaults().catch(() => [] as RecentVault[]);
      let vault = await commands.getVaultInfo().catch(() => null);
      // Launch straight into the last vault — the picker is for switching, not
      // a daily doorstep. "Leave vault" (Settings) still lands on the picker.
      if (!vault && recentVaults[0]) {
        vault = await commands.openVault(recentVaults[0].path).catch(() => null);
      }
      setState((s) => ({ ...s, vault, recentVaults, booting: false }));
    })();
  }, [bootServed]);

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

  const createVault = useCallback(async (template?: string) => {
    const selected = await saveDialog({
      title: template ? "Create a vault from the template" : "Create a vault",
      defaultPath: "cortex-vault",
    });
    if (!selected) return;
    setState((s) => ({ ...s, creating: true, error: null }));
    try {
      await commands.createVaultFromTemplate(selected, template);
      const vault = await commands.openVault(selected);
      setState((s) => ({ ...s, vault, creating: false, error: null }));
    } catch (e) {
      setState((s) => ({ ...s, creating: false, error: String(e) }));
    }
  }, []);

  const forgetRecent = useCallback(async (path: string) => {
    try {
      const recentVaults = await commands.forgetRecent(path);
      setState((s) => ({ ...s, recentVaults }));
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }));
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
    retryServed: bootServed,
    openVault,
    forgetRecent,
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
