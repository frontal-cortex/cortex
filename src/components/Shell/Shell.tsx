import { useState, useCallback, useEffect, useMemo } from "react";
import { VaultInfo, VaultStatus, AgentBranch, CommitEntry } from "../../lib/commands";
import { useNotes, useNote } from "../../hooks/useNotes";
import { Sidebar } from "./Sidebar";
import { NoteList } from "./NoteList";
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
  const [activeView, setActiveView] = useState("all");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);

  const { notes, loading, refresh, createNote, deleteNote } = useNotes(!!vault);
  const { note, saving, save } = useNote(selectedPath);

  // Unique types derived from the note list — no extra command needed
  const availableTypes = useMemo(() => {
    const types = new Set(notes.map((n) => n.note_type).filter(Boolean) as string[]);
    return [...types].sort();
  }, [notes]);

  // Filter notes by active view
  const visibleNotes = useMemo(() => {
    if (activeView === "recent") return [...notes].sort((a, b) => b.modified - a.modified).slice(0, 20);
    if (activeView.startsWith("type:")) {
      const type = activeView.slice(5);
      return notes.filter((n) => n.note_type === type);
    }
    return notes;
  }, [notes, activeView]);

  // Global keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "k") { e.preventDefault(); setShowQuickSwitcher(true); }
      if (meta && e.key === "n") { e.preventDefault(); handleNewNote(); }
      if (e.key === "Escape") setShowQuickSwitcher(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewNote = useCallback(async () => {
    const created = await createNote("");
    setSelectedPath(created.path);
  }, [createNote]);

  const handleTodayNote = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const path = `journal/${today}.md`;
    const existing = notes.find((n) => n.path === path);
    if (existing) { setSelectedPath(path); return; }
    // Try to use templates/daily.md; fall back to empty
    const { commands } = await import("../../lib/commands");
    const templateContent = await commands.readTemplate("daily.md").catch(() => null);
    if (templateContent) {
      const { commands: c2 } = await import("../../lib/commands");
      const note = await c2.createNote(path, today, today);
      // Apply template body (substitute {{date}})
      const body = templateContent.replace(/\{\{date\}\}/g, today).replace(/^---[\s\S]*?---\n\n?/, "");
      await c2.writeNote(path, { ...note, body });
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
    const byTitle = notes.find((n) => (n.title || "").toLowerCase() === lower);
    if (byTitle) { setSelectedPath(byTitle.path); return; }
    const byStem = notes.find((n) =>
      n.path.split("/").pop()?.replace(/\.md$/, "").toLowerCase().includes(lower),
    );
    if (byStem) setSelectedPath(byStem.path);
  }, [notes]);

  return (
    <div className={styles.root}>
      <Sidebar
        vault={vault}
        status={status}
        agentBranches={agentBranches}
        commits={commits}
        availableTypes={availableTypes}
        syncing={syncing}
        activeView={activeView}
        onViewChange={setActiveView}
        onSync={onSync}
        onCommit={onCommit}
        onTodayNote={handleTodayNote}
        onApplyBranch={onApplyBranch}
        onDiscardBranch={onDiscardBranch}
      />
      <NoteList
        notes={visibleNotes}
        loading={loading}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
        onNewNote={handleNewNote}
      />
      <Editor
        note={note}
        saving={saving}
        allNotes={notes}
        onSave={async (updated) => { await save(updated); refresh(); }}
        onDelete={handleDelete}
        onNavigate={(target) => {
          // First try path-based navigation, then title-based
          const byPath = notes.find((n) => n.path === target);
          if (byPath) { setSelectedPath(target); return; }
          handleNavigate(target);
        }}
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
