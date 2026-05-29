import { useState, useCallback, useEffect } from "react";
import { VaultInfo, VaultStatus, AgentBranch, CommitEntry } from "../../lib/commands";
import { useNotes, useNote } from "../../hooks/useNotes";
import { useFavorites } from "../../hooks/useFavorites";
import { useTrash } from "../../hooks/useTrash";
import { useNavHistory } from "../../hooks/useNavHistory";
import { LeftPanel } from "./LeftPanel";
import { Editor } from "./Editor";
import { QuickSwitcher } from "./QuickSwitcher";
import { GraphView } from "./GraphView";
import { TopBar } from "./TopBar";
import { TabBar } from "./TabBar";
import styles from "./Shell.module.css";

interface Props {
  vault: VaultInfo;
  status: VaultStatus | null;
  agentBranches: AgentBranch[];
  commits: CommitEntry[];
  syncing: boolean;
  onSync: () => void;
  onCommit: (message: string) => Promise<void>;
  onApplyBranch: (name: string) => void;
  onDiscardBranch: (name: string) => void;
}

export function Shell({
  vault, status, agentBranches, commits, syncing, onSync,
  onCommit, onApplyBranch, onDiscardBranch,
}: Props) {
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showGraph, setShowGraph] = useState(false);

  const {
    currentPath: selectedPath, tabs, activeTab, canBack, canForward,
    navigate: navTo, back, forward, closeTab, switchTab,
  } = useNavHistory();

  const setSelectedPath = useCallback((path: string, title?: string) => navTo(path, title ?? ""), [navTo]);

  const { notes, dirs, refresh, createNote, createNoteFromTemplate, openOrCreateDaily, deleteNote } = useNotes(!!vault);
  const { note, saving, save, applyNote } = useNote(selectedPath);
  const { favorites, toggleFavorite, isFavorite } = useFavorites(!!vault);
  const { trash, refreshTrash, restore, deleteForever, emptyTrash } = useTrash(!!vault);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "k") { e.preventDefault(); setShowQuickSwitcher(true); }
      if (meta && e.key === "n") { e.preventDefault(); handleNewNote(undefined); }
      if (meta && e.key === "g") { e.preventDefault(); setShowGraph((x) => !x); }
      if (meta && e.key === "[") { e.preventDefault(); back(); }
      if (meta && e.key === "]") { e.preventDefault(); forward(); }
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

  const handleToday = useCallback(async () => {
    const note = await openOrCreateDaily("daily.md");
    setSelectedPath(note.path);
  }, [openOrCreateDaily]);

  const handleNewFromTemplate = useCallback(async (templateName: string) => {
    const note = await createNoteFromTemplate(templateName, "", "notes");
    setSelectedPath(note.path);
  }, [createNoteFromTemplate]);

  const handleRename = useCallback(async (oldPath: string, newPath: string) => {
    const { commands } = await import("../../lib/commands");
    await commands.renameNote(oldPath, newPath);
    await refresh();
    setSelectedPath(newPath, "");
  }, [refresh, setSelectedPath]);

  const handleDelete = useCallback(async (path: string) => {
    // Soft-delete: the note moves to Trash and can be restored, so no scary
    // confirmation is needed.
    await deleteNote(path);
    await refreshTrash();
    if (selectedPath === path) setSelectedPath("", "");
  }, [deleteNote, refreshTrash, selectedPath]);

  const handleRestoreTrashed = useCallback(async (id: string) => {
    const restoredPath = await restore(id);
    await refresh();
    setSelectedPath(restoredPath);
  }, [restore, refresh]);

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
      <TopBar
        vaultName={vault.name}
        status={status}
        syncing={syncing}
        hasRemote={vault.has_remote}
        onSync={onSync}
        onOpenGraph={() => setShowGraph(true)}
        onOpenSwitcher={() => setShowQuickSwitcher(true)}
        onToday={handleToday}
      />

      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        canBack={canBack}
        canForward={canForward}
        onSwitch={switchTab}
        onClose={closeTab}
        onBack={back}
        onForward={forward}
      />

      <div className={styles.body}>
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
          onNewFromTemplate={handleNewFromTemplate}
          onCommit={onCommit}
          onApplyBranch={onApplyBranch}
          onDiscardBranch={onDiscardBranch}
          onRefresh={refresh}
          trash={trash}
          onRestoreTrashed={handleRestoreTrashed}
          onDeleteTrashed={deleteForever}
          onEmptyTrash={emptyTrash}
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
          onApplyNote={applyNote}
        />
      </div>

      {showQuickSwitcher && (
        <QuickSwitcher
          notes={notes}
          onSelect={setSelectedPath}
          onClose={() => setShowQuickSwitcher(false)}
          onNewNote={() => handleNewNote()}
          onToday={handleToday}
          onOpenGraph={() => setShowGraph(true)}
          onNewFromTemplate={handleNewFromTemplate}
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
