import { useState, useCallback, useEffect, useRef } from "react";
import { commands, VaultInfo, VaultStatus, AgentBranch, CommitEntry, SyncOutcome } from "../../lib/commands";
import { useNotes, useNote } from "../../hooks/useNotes";
import { useFavorites } from "../../hooks/useFavorites";
import { useTrash } from "../../hooks/useTrash";
import { useNavHistory } from "../../hooks/useNavHistory";
import { LeftPanel } from "./LeftPanel";
import { Editor } from "./Editor";
import { DatabaseView } from "./DatabaseView";
import {
  isDatabaseNote, collectionNameFromIndex, defaultViews,
  viewToFrontmatter, migrateLegacyIndex,
} from "../../lib/database";
import { QuickSwitcher } from "./QuickSwitcher";
import { QuickCapture } from "./QuickCapture";
import { ConflictModal } from "./ConflictModal";
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
  onSync: () => Promise<SyncOutcome | null>;
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
  const [showCapture, setShowCapture] = useState(false);
  // Conflicted files from a sync that hit a merge conflict; non-null shows the
  // resolution modal. Null = no merge in progress (or user dismissed it).
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  // Bumped to force the editor to re-read a note whose file changed under it
  // (a sync pulled teammate edits, a merge was completed/aborted, …).
  const [reloadToken, setReloadToken] = useState(0);
  const [autoSyncMinutes, setAutoSyncMinutes] = useState(0);
  const [autoCommit, setAutoCommit] = useState(false);
  // Slug of the current git user, used to nest per-person daily notes.
  const [userSlug, setUserSlug] = useState("");
  useEffect(() => {
    commands.currentUser()
      .then((u) => setUserSlug(u.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")))
      .catch(() => {});
  }, []);

  // Apply the saved theme and cache the sync-loop settings when the vault
  // opens; re-read when the settings modal closes (it may have changed them).
  const loadSettings = useCallback(() => {
    commands.getSettings().then((s) => {
      applyTheme(s.theme);
      setAutoSyncMinutes(s.auto_sync_minutes);
      setAutoCommit(s.auto_commit);
    }).catch(() => {});
  }, []);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  const {
    currentPath: selectedPath, canBack, canForward,
    navigate: navTo, back, forward,
  } = useNavHistory();

  const setSelectedPath = useCallback((path: string) => navTo(path), [navTo]);

  const { notes, dirs, refresh, createNote, createNoteFromTemplate, openOrCreateDaily, deleteNote } = useNotes(!!vault);
  const { note, saving, save, applyNote } = useNote(selectedPath);
  const { favorites, toggleFavorite, isFavorite } = useFavorites(!!vault);
  const { trash, refreshTrash, restore, deleteForever, emptyTrash } = useTrash(!!vault);

  // ── Sync loop ────────────────────────────────────────────────────────────────

  // Re-read the open note from disk and remount its editor — used whenever a
  // sync/merge changed files under the app.
  const selectedPathRef = useRef(selectedPath);
  selectedPathRef.current = selectedPath;
  const reloadOpenNote = useCallback(async () => {
    const path = selectedPathRef.current;
    if (!path) return;
    try {
      applyNote(await commands.readNote(path));
      setReloadToken((t) => t + 1);
    } catch { /* note may have been deleted by the merge */ }
  }, [applyNote]);

  const handleSync = useCallback(async () => {
    const outcome = await onSync();
    if (!outcome) return;
    if (outcome.status === "conflicts") {
      setConflicts(outcome.files);
    } else if (outcome.pulled) {
      await refresh();
      await reloadOpenNote();
    }
  }, [onSync, refresh, reloadOpenNote]);

  // Auto-sync: on open, on window focus, and every N minutes. The busy flag
  // stops ticks from stacking; an open conflict modal pauses the loop.
  const handleSyncRef = useRef(handleSync);
  handleSyncRef.current = handleSync;
  const conflictsRef = useRef(conflicts);
  conflictsRef.current = conflicts;
  useEffect(() => {
    if (!vault.has_remote || autoSyncMinutes <= 0) return;
    let busy = false;
    const tick = () => {
      if (busy || conflictsRef.current) return;
      busy = true;
      handleSyncRef.current().finally(() => { busy = false; });
    };
    tick();
    const id = setInterval(tick, autoSyncMinutes * 60_000);
    window.addEventListener("focus", tick);
    return () => { clearInterval(id); window.removeEventListener("focus", tick); };
  }, [vault.has_remote, autoSyncMinutes]);

  // Recover a merge that was left half-resolved (e.g. the app was closed
  // mid-conflict): surface it again on open.
  useEffect(() => {
    commands.gitConflicts()
      .then((files) => { if (files.length) setConflicts(files); })
      .catch(() => {});
  }, []);

  // Auto-commit: debounced commit a little after the last save, so edit bursts
  // become one commit. (Sync also commits dirty work, so this is belt-and-
  // braces for fine-grained history between syncs.)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAutoCommit = useCallback(() => {
    if (!autoCommit) return;
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      onCommit("Auto-commit").catch(() => {});
    }, 30_000);
  }, [autoCommit, onCommit]);
  useEffect(() => () => { if (commitTimer.current) clearTimeout(commitTimer.current); }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); setShowCapture(true); return; }
      if (meta && e.key === "k") { e.preventDefault(); setShowQuickSwitcher(true); }
      if (meta && e.key === "n") { e.preventDefault(); handleNewNote(undefined); }
      if (meta && e.key === "g") { e.preventDefault(); setShowGraph((x) => !x); }
      if (meta && e.key === "[") { e.preventDefault(); back(); }
      if (meta && e.key === "]") { e.preventDefault(); forward(); }
      if (e.key === "Escape") { setShowQuickSwitcher(false); setShowGraph(false); setShowCapture(false); }
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

  // Wiki links inside transclusion embeds dispatch this to navigate by ref.
  useEffect(() => {
    function onNavigate(e: Event) {
      const target = (e as CustomEvent<{ target?: string }>).detail?.target;
      if (typeof target === "string") handleNavigate(target);
    }
    window.addEventListener("cortex:navigate", onNavigate);
    return () => window.removeEventListener("cortex:navigate", onNavigate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const handleNewNote = useCallback(async (parentFolder?: string) => {
    const created = await createNote("", parentFolder);
    setSelectedPath(created.path);
  }, [createNote]);

  const handleToday = useCallback(async () => {
    const note = await openOrCreateDaily("daily.md", userSlug);
    setSelectedPath(note.path);
  }, [openOrCreateDaily, userSlug]);

  const handleNewFromTemplate = useCallback(async (templateName: string) => {
    const note = await createNoteFromTemplate(templateName, "", "notes");
    setSelectedPath(note.path);
  }, [createNoteFromTemplate]);

  // Flip between light and dark, persisting the choice (forcing an explicit
  // theme rather than following the OS, matching how the picker behaves).
  const handleToggleTheme = useCallback(async () => {
    const settings = await commands.getSettings();
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    await commands.setSettings({ ...settings, theme: next });
  }, []);

  // Append a timestamped bullet to today's daily note, creating it if needed —
  // without navigating away from whatever note is open.
  const handleQuickCapture = useCallback(async (text: string) => {
    const now = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    const time = `${p2(now.getHours())}:${p2(now.getMinutes())}`;
    const path = `notes/journal/${userSlug ? `${userSlug}/` : ""}${dateStr}.md`;

    let target;
    try {
      target = await commands.readNote(path);
    } catch {
      target = await commands.createNote(path, dateStr, dateStr);
    }
    const line = `- ${time} ${text}`;
    const base = target.body.replace(/\n+$/, "");
    const body = base ? `${base}\n${line}\n` : `${line}\n`;
    await commands.writeNote(path, { ...target, body });
    await refresh();
    // If today's note is the one on screen, re-read so the new line shows.
    if (selectedPath === path) applyNote(await commands.readNote(path));
  }, [refresh, selectedPath, applyNote, userSlug]);

  // Open a database's `_index.md`, creating it on demand and migrating any legacy
  // index (views embedded as body code-blocks) into the frontmatter-views model.
  const handleOpenCollection = useCallback(async (name: string) => {
    const dir = `collections/${name}`;
    const indexPath = `${dir}/_index.md`;
    const date = new Date().toISOString().split("T")[0];
    try {
      const existing = await commands.readNote(indexPath);
      if (existing.frontmatter["type"] !== "database") {
        // Legacy index → upgrade. Extract any cortex-view fences as views; keep
        // the rest of the body as the database description.
        const { views, body } = migrateLegacyIndex(existing.body);
        const frontmatter = {
          ...existing.frontmatter,
          type: "database",
          title: existing.frontmatter["title"] ?? name,
          views: (views.length ? views : defaultViews()).map(viewToFrontmatter),
        };
        await commands.writeNote(indexPath, { ...existing, frontmatter, body });
        await refresh();
      }
    } catch {
      // No index yet — create a fresh database with the default views.
      const index = await commands.createNote(indexPath, name, date);
      const frontmatter = {
        ...index.frontmatter,
        type: "database",
        views: defaultViews().map(viewToFrontmatter),
      };
      await commands.writeNote(indexPath, { ...index, frontmatter, body: "" });
      await refresh();
    }
    setSelectedPath(indexPath);
  }, [refresh, setSelectedPath]);

  // Create a new database: a `collections/<slug>/` folder, then open its
  // freshly created index (starts empty — rows are added with "+ New").
  const handleNewCollection = useCallback(async () => {
    const name = window.prompt("New database name")?.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "database";
    await commands.createFolder(`collections/${slug}`).catch(() => {});
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
        onSync={handleSync}
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
          onDeleteNote={handleDelete}
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

        {note && isDatabaseNote(note) && collectionNameFromIndex(note.path) ? (
          <DatabaseView
            note={note}
            collectionName={collectionNameFromIndex(note.path)!}
            onSave={async (updated) => { await save(updated); refresh(); scheduleAutoCommit(); }}
          />
        ) : (
          <Editor
            note={note}
            saving={saving}
            allNotes={notes}
            vaultPath={vault.path}
            reloadToken={reloadToken}
            onSave={async (updated) => { await save(updated); refresh(); scheduleAutoCommit(); }}
            onDelete={handleDelete}
            onNavigate={handleNavigate}
            onApplyNote={applyNote}
          />
        )}
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
          onNewCollection={handleNewCollection}
          onSync={handleSync}
          onToggleTheme={handleToggleTheme}
          onOpenSettings={() => setShowSettings(true)}
          onQuickCapture={() => setShowCapture(true)}
          hasRemote={vault.has_remote}
        />
      )}

      {showCapture && (
        <QuickCapture
          onCapture={handleQuickCapture}
          onClose={() => setShowCapture(false)}
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
          onClose={() => { setShowSettings(false); loadSettings(); }}
          onLeaveVault={onLeaveVault}
        />
      )}

      {conflicts && (
        <ConflictModal
          files={conflicts}
          onOpenFile={(path) => setSelectedPath(path)}
          onCompleted={async () => {
            setConflicts(null);
            await refresh();
            await reloadOpenNote();
          }}
          onAborted={async () => {
            setConflicts(null);
            await refresh();
            await reloadOpenNote();
          }}
          onClose={() => setConflicts(null)}
        />
      )}
    </div>
  );
}
