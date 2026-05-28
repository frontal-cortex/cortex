import { useState } from "react";
import { VaultInfo, VaultStatus, AgentBranch } from "../../lib/commands";
import { useNotes, useNote } from "../../hooks/useNotes";
import { Sidebar } from "./Sidebar";
import { NoteList } from "./NoteList";
import { Editor } from "./Editor";
import styles from "./Shell.module.css";

interface Props {
  vault: VaultInfo;
  status: VaultStatus | null;
  agentBranches: AgentBranch[];
  syncing: boolean;
  onSync: () => void;
  onCommit: (message: string) => Promise<void>;
  onApplyBranch: (name: string) => void;
  onDiscardBranch: (name: string) => void;
}

export function Shell({
  vault,
  status,
  agentBranches,
  syncing,
  onSync,
  onCommit,
  onApplyBranch,
  onDiscardBranch,
}: Props) {
  const [activeView, setActiveView] = useState("all");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const { notes, loading, refresh, createNote } = useNotes(!!vault);
  const { note, saving, save } = useNote(selectedPath);

  async function handleNewNote() {
    const created = await createNote("");
    setSelectedPath(created.path);
  }

  return (
    <div className={styles.root}>
      <Sidebar
        vault={vault}
        status={status}
        agentBranches={agentBranches}
        syncing={syncing}
        activeView={activeView}
        onViewChange={setActiveView}
        onSync={onSync}
        onCommit={onCommit}
        onApplyBranch={onApplyBranch}
        onDiscardBranch={onDiscardBranch}
      />
      <NoteList
        notes={notes}
        loading={loading}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
        onNewNote={handleNewNote}
      />
      <Editor
        note={note}
        saving={saving}
        onSave={async (updated) => {
          await save(updated);
          refresh();
        }}
      />
    </div>
  );
}
