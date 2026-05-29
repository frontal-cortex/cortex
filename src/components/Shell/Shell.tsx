import { useState, useCallback, useEffect } from "react";
import { VaultInfo, VaultStatus, AgentBranch, CommitEntry } from "../../lib/commands";
import { useNotes, useNote } from "../../hooks/useNotes";
import { useFavorites } from "../../hooks/useFavorites";
import { LeftPanel } from "./LeftPanel";
import { Editor } from "./Editor";
import { QuickSwitcher } from "./QuickSwitcher";
import { GraphView } from "./GraphView";
import styles from "./Shell.module.css";

interface Props {
  vault: VaultInfo;
  status: VaultStatus | null;
  agentBranches: AgentBranch[];
  commits: CommitEntry[];
  onCommit: (message: string) => Promise<void>;
  onApplyBranch: (name: string) => void;
  onDiscardBranch: (name: string) => void;
}

export function Shell({
  vault, status, agentBranches, commits,
  onCommit, onApplyBranch, onDiscardBranch,
}: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showGraph, setShowGraph] = useState(false);

  const { notes, dirs, refresh, createNote, deleteNote } = useNotes(!!vault);
  const { note, saving, save } = useNote(selectedPath);
  const { favorites, toggleFavorite, isFavorite } = useFavorites(!!vault);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "k") { e.preventDefault(); setShowQuickSwitcher(true); }
      if (meta && e.key === "n") { e.preventDefault(); handleNewNote(undefined); }
      if (meta && e.key === "g") { e.preventDefault(); setShowGraph((x) => !x); }
      if (e.key === "Escape") { setShowQuickSwitcher(false); setShowGraph(false); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewNote = useCallback(async (parentFolder?: string) => {
    const created = await createNote("", parentFolder);
    setSelectedPath(created.path);
  }, [createNote]);

  const handleRename = useCallback(async (oldPath: string, newPath: string) => {
    const { commands } = await import("../../lib/commands");
    await commands.renameNote(oldPath, newPath);
    await refresh();
    setSelectedPath(newPath);
  }, [refresh]);

  const handleDelete = useCallback(async (path: string) => {
    if (!window.confirm("Delete this note? This cannot be undone.")) return;
    await deleteNote(path);
    if (selectedPath === path) setSelectedPath(null);
  }, [deleteNote, selectedPath]);

  const handleNavigate = useCallback((target: string) => {
    const lower = target.toLowerCase();
    const byPath = notes.find((n) => n.path === target);
    if (byPath) { setSelectedPath(target); return; }
    const byTitle = notes.find((n) => (n.title || "").toLowerCase() === lower);
    if (byTitle) { setSelectedPath(byTitle.path); return; }
    const byStem = notes.find((n) =>
      n.path.split("/").pop()?.replace(/\.md$/, "").toLowerCase().includes(lower),
    );
    if (byStem) setSelectedPath(byStem.path);
  }, [notes]);

  return (
    <div className={styles.root}>
      <LeftPanel
        notes={notes}
        dirs={dirs}
        selectedPath={selectedPath}
        status={status}
        agentBranches={agentBranches}
        commits={commits}
        favorites={favorites}
        onSelect={setSelectedPath}
        onNewNote={handleNewNote}
        onToggleFavorite={toggleFavorite}
        isFavorite={isFavorite}
        onOpenGraph={() => setShowGraph(true)}
        onCommit={onCommit}
        onApplyBranch={onApplyBranch}
        onDiscardBranch={onDiscardBranch}
        onRefresh={refresh}
      />

      <Editor
        note={note}
        saving={saving}
        allNotes={notes}
        vaultPath={vault.path}
        onSave={async (updated) => { await save(updated); refresh(); }}
        onDelete={handleDelete}
        onNavigate={handleNavigate}
        onRename={handleRename}
      />

      {showQuickSwitcher && (
        <QuickSwitcher
          notes={notes}
          onSelect={setSelectedPath}
          onClose={() => setShowQuickSwitcher(false)}
        />
      )}

      {showGraph && (
        <GraphView
          notes={notes}
          onNavigate={(path) => { setSelectedPath(path); setShowGraph(false); }}
          onClose={() => setShowGraph(false)}
        />
      )}
    </div>
  );
}
