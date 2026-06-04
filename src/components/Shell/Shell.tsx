import { useState, useCallback, useEffect } from "react";
import { commands, VaultInfo, VaultStatus, AgentBranch, CommitEntry } from "../../lib/commands";
import { useNotes, useNote } from "../../hooks/useNotes";
import { useFavorites } from "../../hooks/useFavorites";
import { useTrash } from "../../hooks/useTrash";
import { useNavHistory } from "../../hooks/useNavHistory";
import { LeftPanel } from "./LeftPanel";
import { Editor } from "./Editor";
import { QuickSwitcher } from "./QuickSwitcher";
import { GraphView } from "./GraphView";
import { TopBar } from "./TopBar";
import { SettingsModal, applyTheme } from "./SettingsModal";
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
  onLeaveVault: () => void;
}

export function Shell({
  vault, status, agentBranches, commits, syncing, onSync,
  onCommit, onApplyBranch, onDiscardBranch, onLeaveVault,
}: Props) {
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Apply the saved theme preference when the vault opens.
  useEffect(() => {
    commands.getSettings().then((s) => applyTheme(s.theme)).catch(() => {});
  }, []);

  const {
    currentPath: selectedPath, canBack, canForward,
    navigate: navTo, back, forward,
  } = useNavHistory();

  const setSelectedPath = useCallback((path: string) => navTo(path), [navTo]);

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

  // Embedded data views (collection rows) dispatch this to open a row as a note.
  useEffect(() => {
    function onOpenNote(e: Event) {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (typeof path === "string") setSelectedPath(path);
    }
    window.addEventListener("cortex:open-note", onOpenNote);
    return () => window.removeEventListener("cortex:open-note", onOpenNote);
  }, [setSelectedPath]);

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

  // Open a collection's `_index.md` "home" note (a board + table over its rows),
  // creating it on demand — so pre-existing collections without an index work too.
  const handleOpenCollection = useCallback(async (name: string) => {
    const dir = `collections/${name}`;
    const indexPath = `${dir}/_index.md`;
    try {
      await commands.readNote(indexPath);
    } catch {
      const date = new Date().toISOString().split("T")[0];
      const body =
        "## Board\n\n" +
        "```cortex-view\n" + `source: ${dir}\n` + "type: board\ngroup: status\n```\n\n" +
        "## All items\n\n" +
        "```cortex-view\n" + `source: ${dir}\n` + "type: table\n```\n";
      const index = await commands.createNote(indexPath, name, date);
      await commands.writeNote(indexPath, { ...index, body });
      await refresh();
    }
    setSelectedPath(indexPath);
  }, [refresh, setSelectedPath]);

  // Start a collection from scratch: a `collections/<slug>/` folder with a
  // starter row, then open its (freshly created) index note.
  const handleNewCollection = useCallback(async () => {
    const name = window.prompt("New collection name")?.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "collection";
    const dir = `collections/${slug}`;
    const date = new Date().toISOString().split("T")[0];
    await commands.createFolder(dir).catch(() => {});
    await commands.createNote(`${dir}/first-item.md`, "First item", date).catch(() => {});
    await handleOpenCollection(slug);
  }, [handleOpenCollection]);

  const handleDelete = useCallback(async (path: string) => {
    // Soft-delete: the note moves to Trash and can be restored, so no scary
    // confirmation is needed.
    await deleteNote(path);
    await refreshTrash();
    if (selectedPath === path) setSelectedPath("");
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
        canBack={canBack}
        canForward={canForward}
        onBack={back}
        onForward={forward}
        onSync={onSync}
        onOpenGraph={() => setShowGraph(true)}
        onOpenSwitcher={() => setShowQuickSwitcher(true)}
        onToday={handleToday}
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
          onNewCollection={handleNewCollection}
          onOpenCollection={handleOpenCollection}
          onOpenSettings={() => setShowSettings(true)}
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

      {showSettings && (
        <SettingsModal
          vault={vault}
          onClose={() => setShowSettings(false)}
          onLeaveVault={onLeaveVault}
        />
      )}
    </div>
  );
}
