import { useEffect } from "react";
import "./styles/tokens.css";
import "./styles/fonts.css";
import { useVault } from "./hooks/useVault";
import { useViewportAttribute } from "./hooks/useViewport";
import { initThemeListener } from "./lib/theme";
import { isMac } from "./lib/keymap";
import { VaultPicker } from "./components/VaultPicker/VaultPicker";
import { Shell } from "./components/Shell/Shell";
import styles from "./App.module.css";

export default function App() {
  const vault = useVault();
  useEffect(() => initThemeListener(), []);
  // Lets CSS make platform calls (e.g. room for macOS window controls).
  useEffect(() => { document.documentElement.dataset.platform = isMac ? "mac" : "other"; }, []);
  // …and viewport calls: `data-viewport` is how CSS knows a phone from a desktop (lib/breakpoints.ts).
  useViewportAttribute();

  // While deciding whether to reopen the last vault, show only the app
  // background rather than a landing page that would vanish a moment later.
  if (vault.booting) return <div className={styles.root} />;

  return (
    <div className={styles.root}>
      {!vault.vault ? (
        <>
          <div className={styles.titleBar} data-tauri-drag-region />
          <VaultPicker
            onOpen={vault.openVault}
            onCreate={vault.createVault}
            onOpenRecent={vault.openVaultPath}
            recentVaults={vault.recentVaults}
            creating={vault.creating}
            error={vault.error}
          />
        </>
      ) : (
        <Shell
          vault={vault.vault}
          status={vault.status}
          agentBranches={vault.agentBranches}
          commits={vault.commits}
          syncing={vault.syncing}
          onSync={vault.sync}
          onCommit={async (msg) => { await vault.commit(msg); }}
          onApplyBranch={vault.applyAgentBranch}
          onDiscardBranch={vault.discardAgentBranch}
          onLeaveVault={vault.closeVault}
          onRefreshStatus={vault.refreshStatus}
        />
      )}
    </div>
  );
}
