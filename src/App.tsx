import { useEffect, useRef } from "react";
import "./styles/tokens.css";
import "./styles/fonts.css";
import { useVault } from "./hooks/useVault";
import { useViewportAttribute } from "./hooks/useViewport";
import { initThemeListener, syncTheme } from "./lib/theme";
import { commands } from "./lib/commands";
import { isMac } from "./lib/keymap";
import { VaultPicker } from "./components/VaultPicker/VaultPicker";
import { Shell } from "./components/Shell/Shell";
import styles from "./App.module.css";

export default function App() {
  const vault = useVault();
  useEffect(() => initThemeListener(), []);
  // No vault open — the landing page — still wears the desktop's palette when
  // it publishes one, so the first thing seen matches the rest of the desktop.
  // A vault's own settings take over the moment one opens (Shell syncs them),
  // and are never overridden by a late answer here.
  const openRef = useRef(false);
  openRef.current = !!vault.vault;
  useEffect(() => {
    if (vault.vault) return;
    commands.detectDesktopTheme().then((file) => {
      if (file && !openRef.current) void syncTheme({ theme: "system", theme_file: file, prose_font: "", prose_slant: "" });
    }).catch(() => {});
  }, [vault.vault]);
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
            onForgetRecent={vault.forgetRecent}
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
