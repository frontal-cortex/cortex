import { useState, useCallback, useEffect } from "react";
import { VaultInfo, VaultStatus, AgentBranch, CommitEntry } from "../../lib/commands";
import { useNotes, useNote } from "../../hooks/useNotes";
import { LeftPanel } from "./LeftPanel";
import { Editor } from "./Editor";
import { QuickSwitcher } from "./QuickSwitcher";
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
  vault, status, agentBranches, commits, syncing,
  onSync, onCommit, onApplyBranch, onDiscardBranch,
}: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);

  const { notes, dirs, refresh, createNote, deleteNote } = useNotes(!!vault);
  const { note, saving, save } = useNote(selectedPath);

  // Global keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "k") { e.preventDefault(); setShowQuickSwitcher(true); }
      if (meta && e.key === "n") { e.preventDefault(); handleNewNote(undefined); }
      if (e.key === "Escape") setShowQuickSwitcher(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewNote = useCallback(async (parentFolder?: string) => {
    const created = await createNote("", parentFolder);
    setSelectedPath(created.path);
  }, [createNote]);

  const handleTodayNote = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const path = `notes/journal/${today}.md`;
    if (notes.find((n) => n.path === path)) { setSelectedPath(path); return; }

    const { commands } = await import("../../lib/commands");
    const tmpl = await commands.readTemplate("daily.md").catch(() => null);
    if (tmpl) {
      const n = await commands.createNote(path, today, today);
      const body = tmpl.replace(/\{\{date\}\}/g, today).replace(/^---[\s\S]*?---\n\n?/, "");
      await commands.writeNote(path, { ...n, body });
    } else {
      await commands.createNote(path, today, today);
    }
    await refresh();
    setSelectedPath(path);
  }, [notes, refresh]);

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
        vault={vault}
        notes={notes}
        dirs={dirs}
        selectedPath={selectedPath}
        status={status}
        agentBranches={agentBranches}
        commits={commits}
        syncing={syncing}
        onSelect={setSelectedPath}
        onNewNote={handleNewNote}
        onTodayNote={handleTodayNote}
        onSync={onSync}
        onCommit={onCommit}
        onApplyBranch={onApplyBranch}
        onDiscardBranch={onDiscardBranch}
        onRefresh={refresh}
      />

      <Editor
        note={note}
        saving={saving}
        allNotes={notes}
        onSave={async (updated) => { await save(updated); refresh(); }}
        onDelete={handleDelete}
        onNavigate={handleNavigate}
      />

      {showQuickSwitcher && (
        <QuickSwitcher
          notes={notes}
          onSelect={setSelectedPath}
          onClose={() => setShowQuickSwitcher(false)}
        />
      )}
    </div>
  );
}
