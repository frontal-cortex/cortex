import "./styles/tokens.css";
import { useVault } from "./hooks/useVault";
import { VaultPicker } from "./components/VaultPicker/VaultPicker";
import { Shell } from "./components/Shell/Shell";
import styles from "./App.module.css";

export default function App() {
  const vault = useVault();

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
        />
      )}
    </div>
  );
}
