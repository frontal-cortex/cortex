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
      syncing={vault.syncing}
      onSync={vault.sync}
      onCommit={vault.commit}
      onApplyBranch={vault.applyAgentBranch}
      onDiscardBranch={vault.discardAgentBranch}
    />
  );
}
