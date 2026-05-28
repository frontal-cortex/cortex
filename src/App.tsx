import "./styles/tokens.css";
import { useVault } from "./hooks/useVault";
import { VaultPicker } from "./components/VaultPicker/VaultPicker";
import { Shell } from "./components/Shell/Shell";

export default function App() {
  const vault = useVault();

  if (!vault.vault) {
    return <VaultPicker onOpen={vault.openVault} error={vault.error} />;
  }

  return (
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
  );
}
