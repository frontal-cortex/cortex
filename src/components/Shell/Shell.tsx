import { useState, useCallback } from "react";
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

  const { notes, loading, refresh, createNote, deleteNote } = useNotes(!!vault);
  const { note, saving, save } = useNote(selectedPath);

  const handleNewNote = useCallback(async () => {
    const created = await createNote("");
    setSelectedPath(created.path);
  }, [createNote]);

  const handleDelete = useCallback(
    async (path: string) => {
      if (!window.confirm("Delete this note? This cannot be undone.")) return;
      await deleteNote(path);
      if (selectedPath === path) setSelectedPath(null);
    },
    [deleteNote, selectedPath],
  );

  // Wiki link navigation: find note by title match, then by path stem
  const handleNavigate = useCallback(
    (target: string) => {
      const lower = target.toLowerCase();
      const byTitle = notes.find(
        (n) => (n.title || "").toLowerCase() === lower,
      );
      if (byTitle) {
        setSelectedPath(byTitle.path);
        return;
      }
      // Fallback: match filename stem
      const byStem = notes.find((n) =>
        n.path
          .split("/")
          .pop()
          ?.replace(/\.md$/, "")
          .toLowerCase()
          .includes(lower),
      );
      if (byStem) {
        setSelectedPath(byStem.path);
      }
      // If not found: could offer to create — future enhancement
    },
    [notes],
  );

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
        onDelete={handleDelete}
        onNavigate={handleNavigate}
      />
    </div>
  );
}
