import { useState, useCallback, useEffect, useRef, CSSProperties, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands, VaultInfo, VaultStatus, AgentBranch, CommitEntry, SyncOutcome, VaultChanged, Settings } from "../../lib/commands";
import { parseWikiLink } from "../../lib/wikiLink";
import { findShortcut, applyKeymapOverrides, ShortcutId } from "../../lib/keymap";
import { useNotes, useNote } from "../../hooks/useNotes";
import { useFavorites } from "../../hooks/useFavorites";
import { useTrash } from "../../hooks/useTrash";
import { useNavHistory } from "../../hooks/useNavHistory";
import { useLayout } from "../../hooks/useLayout";
import { useTypingFocus } from "../../hooks/useTypingFocus";
import { useViewport } from "../../hooks/useViewport";
import { useSidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX } from "../../hooks/useSidebarWidth";
import { useRecentNotes } from "../../hooks/useRecentNotes";
import { ExplorerSort, DEFAULT_SORT, parseExplorerSort, formatExplorerSort } from "../../lib/fileTree";
import { useComments } from "../../hooks/useComments";
import { LeftPanel, LeftPanelHandle } from "./LeftPanel";
import { Editor, EditorHandle } from "./Editor";
import { defaultViews, viewToFrontmatter, migrateLegacyIndex } from "../../lib/database";
import { CollabConfig, loadCollabConfig, startVaultRoom, stopVaultRoom } from "../../lib/collab";
import { QuickSwitcher } from "./QuickSwitcher";
import { QuickCapture } from "./QuickCapture";
import { ConflictModal } from "./ConflictModal";
import { GraphView } from "./GraphView";
import { TagView } from "./TagView";
import { TopBar } from "./TopBar";
import { TerminalPane, TerminalPaneHandle } from "./TerminalPane";
import { SettingsView } from "./SettingsView";
import { MarketplaceView } from "./MarketplaceView";
import { LogTodayModal } from "./LogTodayModal";
import { PublishModal } from "./PublishModal";
import { ImportModal } from "./ImportModal";
import { ShortcutOverlay } from "./ShortcutOverlay";
import { UpdateModal } from "./UpdateModal";
import { syncTheme } from "../../lib/theme";
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
  onRefreshStatus: () => Promise<void>;
}

export function Shell({
  vault, status, agentBranches, commits, syncing, onSync,
  onCommit, onApplyBranch, onDiscardBranch, onLeaveVault, onRefreshStatus,
}: Props) {
  // Quick switcher: null = closed; "actions" opens it straight into `>` mode.
  const [switcher, setSwitcher] = useState<null | "notes" | "actions">(null);
  // At phone widths the sidebar is an overlay drawer (see useLayout).
  const { isPhone: drawer } = useViewport();
  const { leftVisible, rightVisible, monk, typingHidden, toggleLeft, closeLeft, toggleRight, toggleMonk, hideForTyping, showAfterTyping } = useLayout(drawer);
  // The terminal mounts the first time its pane opens and then stays mounted
  // (hidden) so the session survives toggling.
  const [terminalMounted, setTerminalMounted] = useState(false);
  useEffect(() => { if (rightVisible) setTerminalMounted(true); }, [rightVisible]);
  // Opening the terminal puts the cursor in it — that's what Ctrl+L is for.
  const termRef = useRef<TerminalPaneHandle>(null);
  const handleToggleTerminal = useCallback(() => {
    const opening = monk || !rightVisible;
    toggleRight();
    if (opening) requestAnimationFrame(() => termRef.current?.focus());
  }, [monk, rightVisible, toggleRight]);
  // The graph modal: closed, or open globally / locally around the open note.
  const [showGraph, setShowGraph] = useState<false | "global" | "local">(false);
  // A tag page: the notes carrying this tag, as a view over the index (nothing written).
  const [openTag, setOpenTag] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // The template marketplace — a full-window page like Settings.
  const [showMarketplace, setShowMarketplace] = useState(false);
  // Today's checklist — every tracker view in the vault, compact.
  const [showLogToday, setShowLogToday] = useState(false);
  // The Publish dialog — the only path to a published site, always by hand.
  const [showPublish, setShowPublish] = useState(false);
  // The Import dialog — CSV into a collection, or a Markdown folder into notes/.
  const [showImport, setShowImport] = useState(false);
  // Check for updates — asks the release channel, installs only on confirm.
  const [showUpdate, setShowUpdate] = useState(false);
  const [showCapture, setShowCapture] = useState(false);
  // The `?` overlay — every shortcut, read from the keymap registry.
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Sidebar width: dragged on its edge, remembered per vault (localStorage).
  const { width: sidebarWidth, setWidth: setSidebarWidth, reset: resetSidebarWidth } = useSidebarWidth(vault.path);
  const sidebarDrag = useRef<{ startX: number; startW: number } | null>(null);
  // Order of notes in the sidebar tree — `explorer_sort` in settings.yaml, so
  // it travels with the vault; the sort menu writes it back through settings.
  const [explorerSort, setExplorerSortState] = useState<ExplorerSort>(DEFAULT_SORT);
  const handleSetExplorerSort = useCallback(async (sort: ExplorerSort) => {
    setExplorerSortState(sort);
    try {
      const s = await commands.getSettings();
      await commands.setSettings({ ...s, explorer_sort: formatExplorerSort(sort) });
    } catch (e) { console.warn("explorer_sort not saved", e); }
  }, []);
  // Conflicted files from a sync that hit a merge conflict; non-null shows the
  // resolution modal. Null = no merge in progress (or user dismissed it).
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  // Bumped to force the editor to re-read a note whose file changed under it
  // (a sync pulled teammate edits, a merge was completed/aborted, …).
  const [reloadToken, setReloadToken] = useState(0);
  const [autoSyncMinutes, setAutoSyncMinutes] = useState(0);
  // Seconds of typing after which the sidebar steps aside; 0 = never.
  const [typingFocusSeconds, setTypingFocusSeconds] = useState(0);
  const [autoCommit, setAutoCommit] = useState(false);
  // Agent CLI the terminal pane launches on open (Settings → Terminal agent).
  const [terminalCommand, setTerminalCommand] = useState("");
  // Slug of the current git user, used to nest per-person daily notes.
  const [userSlug, setUserSlug] = useState("");
  useEffect(() => {
    commands.currentUser()
      .then((u) => setUserSlug(u.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")))
      .catch(() => {});
  }, []);

  // Collaboration relay config (presence + co-editing); null = off.
  const [collab, setCollab] = useState<CollabConfig | null>(null);

  // Apply the saved theme and cache the sync-loop settings when the vault
  // opens; re-read when the settings modal closes (it may have changed them).
  // What Today opens: a note template under templates/, or `collections/<name>`.
  const [journalTemplate, setJournalTemplate] = useState("daily.md");
  const loadSettings = useCallback(() => {
    commands.getSettings().then((s) => {
      syncTheme(s);
      setJournalTemplate(s.journal_template?.trim() || "daily.md");
      applyKeymapOverrides(s.keybindings);
      setExplorerSortState(parseExplorerSort(s.explorer_sort));
      setTerminalCommand(s.terminal_command ?? "");
      setAutoSyncMinutes(s.auto_sync_minutes);
      setAutoCommit(s.auto_commit);
      setTypingFocusSeconds(s.typing_focus_seconds ?? 0);
    }).catch(() => {});
    loadCollabConfig(vault.name).then(setCollab).catch(() => setCollab(null));
  }, [vault.name]);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Vault-wide collab room: presence + "something changed" nudges from teammates.
  useEffect(() => {
    if (!collab) return;
    startVaultRoom(collab);
    return () => stopVaultRoom();
  }, [collab]);

  const {
    currentPath: selectedPath, canBack, canForward,
    navigate: navTo, back, forward,
  } = useNavHistory();
  const selectedPathRefForFocus = useRef(selectedPath);
  selectedPathRefForFocus.current = selectedPath;

  const setSelectedPath = useCallback((path: string) => navTo(path), [navTo]);

  // ── Focus choreography ──────────────────────────────────────────────────────
  // Keyboard-first means the cursor is always somewhere useful: a new note
  // puts you in its title, opening a note puts you in its body, closing a
  // dialog or the sidebar hands focus back to the page. Because notes load
  // asynchronously, the intent is parked here and applied once the note is in.
  const editorRef = useRef<EditorHandle>(null);
  const leftRef = useRef<LeftPanelHandle>(null);
  const pendingFocus = useRef<"title" | "body" | null>(null);
  /** Heading to scroll to once a `[[Note#Section]]` target has opened. */
  const pendingSection = useRef<string | null>(null);
  const focusEditor = useCallback(() => { editorRef.current?.focusBody(); }, []);

  // While you write, the sidebar steps aside (Settings → Appearance). The
  // pointer at the left edge, Escape, the toggle or moving on brings it back.
  useTypingFocus({
    seconds: typingFocusSeconds,
    enabled: !drawer && !monk,
    hidden: typingHidden,
    onHide: hideForTyping,
    onShow: showAfterTyping,
  });

  // The drawer gets out of the way once you have picked something — a note, a
  // tag page, a full-window page — and Escape (or a tap on the backdrop)
  // closes it by hand. The desktop pane never auto-closes.
  const drawerOpen = drawer && leftVisible;
  useEffect(() => { if (drawer) closeLeft(); }, [drawer, closeLeft, selectedPath, openTag, showSettings, showMarketplace, showGraph]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { closeLeft(); focusEditor(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeLeft, focusEditor]);
  useEffect(() => {
    const t = setTimeout(() => { if (!selectedPathRefForFocus.current) leftRef.current?.focus(); }, 250);
    return () => clearTimeout(t);
  }, []);
  /** Open a note and land in its body (or title, for a fresh one). */
  const openNote = useCallback((path: string, where: "title" | "body" = "body") => {
    if (path === selectedPathRefForFocus.current) {
      requestAnimationFrame(() => where === "title" ? editorRef.current?.focusTitle() : editorRef.current?.focusBody());
    } else {
      pendingFocus.current = where;
    }
    setSelectedPath(path);
  }, [setSelectedPath]);

  const { notes, dirs, tags, refresh, createNote, createNoteFromTemplate, openOrCreateDaily, deleteNote } = useNotes(!!vault);
  const { note, saving, save, applyNote } = useNote(selectedPath);
  // The open note's comment threads (its `.comments.yaml` sidecar) and the
  // margin that shows them. Open/closed is a way of reading, so it lives in
  // localStorage like the outline.
  const commentsApi = useComments(selectedPath ?? "");
  const [commentsOpen, setCommentsOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("cortex.commentsOpen") === "1"; } catch { return false; }
  });
  const toggleComments = useCallback(() => {
    setCommentsOpen((v) => {
      try { localStorage.setItem("cortex.commentsOpen", v ? "0" : "1"); } catch { /* fine */ }
      return !v;
    });
  }, []);
  useEffect(() => {
    const where = pendingFocus.current;
    if (!where || !note || note.path !== selectedPath) return;
    pendingFocus.current = null;
    const section = pendingSection.current;
    pendingSection.current = null;
    // Next frame: the editor mounts on this render and registers its handle.
    requestAnimationFrame(() => {
      if (where === "title") editorRef.current?.focusTitle(); else editorRef.current?.focusBody();
      if (section) editorRef.current?.scrollToHeading(section);
    });
  }, [note, selectedPath]);
  const { favorites, toggleFavorite, isFavorite } = useFavorites(!!vault);
  const { trash, refreshTrash, restore, deleteForever, emptyTrash } = useTrash(!!vault);
  // Whatever is on screen is the most recently opened note.
  const { recent: recentNotes, record: recordRecent } = useRecentNotes(!!vault);
  useEffect(() => { if (selectedPath) recordRecent(selectedPath); }, [selectedPath, recordRecent]);

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

  // ── Follow the filesystem ───────────────────────────────────────────────────
  // The Rust watcher emits one event per burst of external changes (an agent
  // writing on a branch, an editor, a git checkout); echoes of our own writes
  // are filtered out on that side. Refresh what changed, and only remount the
  // editor when the open note's content actually differs from what's on screen.
  const noteRef = useRef(note);
  noteRef.current = note;
  const watchDeps = useRef({ refresh, loadSettings, onRefreshStatus, applyNote });
  watchDeps.current = { refresh, loadSettings, onRefreshStatus, applyNote };
  useEffect(() => {
    const unlisten = listen<VaultChanged>("vault://changed", async ({ payload }) => {
      const { refresh, loadSettings, onRefreshStatus, applyNote } = watchDeps.current;
      if (payload.notes.length || payload.removed.length || payload.dirs) {
        await refresh();
        window.dispatchEvent(new CustomEvent("cortex:data-changed"));
        const open = selectedPathRef.current;
        if (open && payload.notes.includes(open)) {
          try {
            const fresh = await commands.readNote(open);
            const cur = noteRef.current;
            const same = !!cur && fresh.body === cur.body &&
              JSON.stringify(fresh.frontmatter) === JSON.stringify(cur.frontmatter);
            if (!same) { applyNote(fresh); setReloadToken((t) => t + 1); }
          } catch { /* vanished between the event and the read */ }
        }
      }
      if (payload.config) loadSettings();
      // A comment sidecar changed under us (an agent, a teammate's sync): the
      // panel for that note reloads.
      for (const path of payload.comments ?? []) {
        window.dispatchEvent(new CustomEvent("cortex:comments-changed", { detail: { path } }));
      }
      // Any write dirties the working tree; refs moving changes branches/commits.
      onRefreshStatus();
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const handleSync = useCallback(async () => {
    const outcome = await onSync();
    if (!outcome) return;
    if (outcome.status === "conflicts") {
      setConflicts(outcome.files);
    } else if (outcome.pulled) {
      await refresh();
      await reloadOpenNote();
      // Tell open data views (tables/boards in the editor or a database tab)
      // to re-run their queries against the freshly pulled files.
      window.dispatchEvent(new CustomEvent("cortex:data-changed"));
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

  // A teammate's edit arrived over the relay: pull it soon (debounced — bursts
  // of edits become one sync). The sync itself then refreshes views.
  useEffect(() => {
    if (!collab) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onRemote = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!conflictsRef.current) handleSyncRef.current();
      }, 1500);
    };
    window.addEventListener("cortex:remote-data-changed", onRemote);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("cortex:remote-data-changed", onRemote);
    };
  }, [collab]);

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

  // App shortcuts come from the keymap registry (lib/keymap.ts). The handlers
  // live in a ref (assigned below, once they exist) so the listener is
  // registered once yet always calls the latest closures. Capture phase: an
  // app shortcut wins over whatever the focused editor or terminal would do
  // with the same keys; Escape is left for them to see too.
  const actionsRef = useRef<Record<ShortcutId, () => void> | null>(null);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { setSwitcher(null); setShowGraph(false); setOpenTag(null); setShowCapture(false); setShowShortcuts(false); return; }
      // A bare `?` (outside a text field, where it is just typing) is the
      // shortcut overlay too — the Obsidian / GitHub habit. `mod+/` always works.
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      const id = findShortcut(e);
      if (!id) return;
      // A widget with a find of its own (a data view's search box) keeps mod+f
      // while it has focus; the editor's find-in-note is untouched elsewhere.
      if (id === "find-in-note" && (e.target as HTMLElement | null)?.closest?.("[data-find-scope]")) return;
      e.preventDefault();
      e.stopPropagation();
      actionsRef.current?.[id]();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Embedded data views (collection rows) dispatch this to open a row as a note.
  useEffect(() => {
    function onOpenNote(e: Event) {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (typeof path === "string") openNote(path);
    }
    window.addEventListener("cortex:open-note", onOpenNote);
    return () => window.removeEventListener("cortex:open-note", onOpenNote);
  }, [openNote]);

  // Settings → Templates (and anything else outside the shell) opens the marketplace this way.
  useEffect(() => {
    const onOpen = () => { setShowSettings(false); setShowMarketplace(true); };
    window.addEventListener("cortex:open-marketplace", onOpen);
    return () => window.removeEventListener("cortex:open-marketplace", onOpen);
  }, []);

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
    openNote(created.path, "title");
  }, [createNote, openNote]);

  const handleToday = useCallback(async () => {
    const note = await openOrCreateDaily(journalTemplate, userSlug);
    openNote(note.path);
  }, [openOrCreateDaily, journalTemplate, userSlug, openNote]);

  const handleNewFromTemplate = useCallback(async (templateName: string) => {
    const note = await createNoteFromTemplate(templateName, "", "notes");
    openNote(note.path, "title");
  }, [createNoteFromTemplate, openNote]);

  // Flip between light and dark, persisting the choice. An explicit pick is
  // a deliberate override, so it also stops following a desktop palette.
  const handleToggleTheme = useCallback(async () => {
    const settings = await commands.getSettings();
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    const updated: Settings = { ...settings, theme: next, theme_file: "" };
    await commands.setSettings(updated);
    await syncTheme(updated);
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
    const name = window.prompt("New collection name")?.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "database";
    await commands.createFolder(`collections/${slug}`).catch(() => {});
    await handleOpenCollection(slug);
  }, [handleOpenCollection]);

  // Turn a checklist note into a database, then trash the original (recoverable).
  const handleTurnIntoDatabase = useCallback(async (path: string) => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const indexPath = await commands.convertNoteToDatabase(path, date);
      await deleteNote(path);
      await refreshTrash();
      await refresh();
      setSelectedPath(indexPath);
    } catch (e) { window.alert(String(e)); }
  }, [deleteNote, refreshTrash, refresh, setSelectedPath]);

  // Turn a database back into a checklist note, then delete the collection.
  const handleConvertToNote = useCallback(async (name: string) => {
    if (!window.confirm(
      "Convert this collection to a checklist note? Each row becomes a checkbox line, and the collection (its row files) is deleted.",
    )) return;
    try {
      const notePath = await commands.convertDatabaseToNote(name);
      await commands.deleteFolder(`collections/${name}`);
      await refresh();
      setSelectedPath(notePath);
    } catch (e) { window.alert(String(e)); }
  }, [refresh, setSelectedPath]);

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

  // Follow a wiki link in any written form: `Note`, `Note|alias`, `Note#Section`,
  // `![[Note#Section]]`. The note is picked by cortex-core `vault::resolve`
  // (path, then title, then exact filename stem) — the same resolver the CLI,
  // embeds and the publisher use; a section scrolls to that heading once the
  // note is open. `[[#Section]]` stays in the current note.
  const handleNavigate = useCallback((raw: string) => {
    const link = parseWikiLink(raw);
    if (!link.target) {
      if (link.section) editorRef.current?.scrollToHeading(link.section);
      return;
    }
    void (async () => {
      const found = await commands.resolveNote(link.target).catch(() => null);
      if (!found) return;
      if (found.path === selectedPathRefForFocus.current) {
        openNote(found.path);
        if (link.section) editorRef.current?.scrollToHeading(link.section);
        return;
      }
      pendingSection.current = link.section ?? null;
      openNote(found.path);
    })();
  }, [openNote]);

  actionsRef.current = {
    "quick-switcher":  () => setSwitcher("notes"),
    "command-palette": () => setSwitcher("actions"),
    "quick-capture":   () => setShowCapture(true),
    "new-note":        () => { handleNewNote(undefined); },
    "today":           () => { handleToday(); },
    "graph":           () => setShowGraph((x) => (x ? false : "global")),
    "local-graph":     () => setShowGraph((x) => (x === "local" ? false : "local")),
    "back":            back,
    "forward":         forward,
    "settings":        () => setShowSettings((v) => !v),
    "toggle-sidebar":  () => { if (leftVisible) focusEditor(); toggleLeft(); },
    "toggle-terminal": handleToggleTerminal,
    "monk-mode":       () => { toggleMonk(); requestAnimationFrame(focusEditor); },
    "focus-sidebar":   () => { if (!leftVisible) toggleLeft(); requestAnimationFrame(() => leftRef.current?.focus()); },
    "focus-editor":    focusEditor,
    "toggle-properties": () => editorRef.current?.toggleProperties(),
    "marketplace":     () => setShowMarketplace((v) => !v),
    "log-today":       () => setShowLogToday((v) => !v),
    "find-in-note":    () => editorRef.current?.openFind(),
    "toggle-outline":  () => editorRef.current?.toggleOutline(),
    "toggle-comments": () => { if (note) toggleComments(); },
    "comment":         () => editorRef.current?.commentOnSelection(),
    "shortcut-help":   () => setShowShortcuts((v) => !v),
  };

  // ── Sidebar resize handle ──────────────────────────────────────────────────
  // Pointer capture keeps the drag alive when the cursor outruns the 6px
  // handle; double-click restores the default; arrows nudge it from the keyboard.
  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    sidebarDrag.current = { startX: e.clientX, startW: sidebarWidth };
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = sidebarDrag.current;
    if (d) setSidebarWidth(d.startW + e.clientX - d.startX);
  };
  const onHandleUp = () => { sidebarDrag.current = null; };
  const onHandleKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); setSidebarWidth(sidebarWidth - 16); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setSidebarWidth(sidebarWidth + 16); }
    else if (e.key === "Home" || e.key === "Enter") { e.preventDefault(); resetSidebarWidth(); }
  };

  return (
    <div className={`${styles.root} ${monk ? styles.monk : ""}`}>
      {!monk && <TopBar
        vaultName={vault.name}
        status={status}
        syncing={syncing}
        hasRemote={vault.has_remote}
        canBack={canBack}
        canForward={canForward}
        onBack={back}
        onForward={forward}
        onSync={handleSync}
        onOpenGraph={() => setShowGraph("global")}
        onOpenSwitcher={() => setSwitcher("notes")}
        onToday={handleToday}
        leftOpen={leftVisible}
        rightOpen={rightVisible}
        onToggleLeft={toggleLeft}
        onToggleRight={handleToggleTerminal}
        onToggleMonk={toggleMonk}
        commentsOpen={commentsOpen}
        unresolvedComments={commentsApi.unresolved}
        hasNote={!!note}
        onToggleComments={toggleComments}
      />}

      <div className={styles.body} style={{ "--left-panel-width": `${sidebarWidth}px` } as CSSProperties}>
        {drawerOpen && <div className={styles.backdrop} onClick={() => { closeLeft(); focusEditor(); }} aria-hidden />}
        <div className={`${styles.leftSlot} ${drawer ? styles.drawer : ""}`} style={leftVisible ? undefined : { display: "none" }}>
        <LeftPanel
          ref={leftRef}
          onEscape={focusEditor}
          onOpenCommandPalette={() => setSwitcher("actions")}
          notes={notes}
          dirs={dirs}
          tags={tags}
          recent={recentNotes}
          explorerSort={explorerSort}
          onSetExplorerSort={handleSetExplorerSort}
          onOpenTag={setOpenTag}
          selectedPath={selectedPath}
          status={status}
          agentBranches={agentBranches}
          commits={commits}
          favorites={favorites}
          onSelect={(p) => { openNote(p); if (drawer) closeLeft(); }}
          onNewNote={handleNewNote}
          onDeleteNote={handleDelete}
          onTurnIntoDatabase={handleTurnIntoDatabase}
          onToggleFavorite={toggleFavorite}
          isFavorite={isFavorite}
          onOpenGraph={() => setShowGraph("global")}
          onNewFromTemplate={handleNewFromTemplate}
          onNewCollection={handleNewCollection}
          onOpenCollection={handleOpenCollection}
          onOpenSettings={() => setShowSettings(true)}
          onOpenMarketplace={() => setShowMarketplace(true)}
          onCommit={onCommit}
          onApplyBranch={onApplyBranch}
          onDiscardBranch={onDiscardBranch}
          onRefresh={refresh}
          trash={trash}
          onRestoreTrashed={handleRestoreTrashed}
          onDeleteTrashed={deleteForever}
          onEmptyTrash={emptyTrash}
        />
        <div
          className={styles.resizeHandle}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={sidebarWidth}
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          tabIndex={0}
          title="Drag to resize the sidebar · double-click resets"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          onDoubleClick={resetSidebarWidth}
          onKeyDown={onHandleKey}
        />
        </div>

        <Editor
          ref={editorRef}
          note={note}
          saving={saving}
          allNotes={notes}
          tags={tags}
          vaultPath={vault.path}
          reloadToken={reloadToken}
          collab={collab}
          monk={monk}
          onSave={async (updated) => { await save(updated); refresh(); scheduleAutoCommit(); }}
          onDelete={handleDelete}
          onNavigate={handleNavigate}
          onApplyNote={applyNote}
          onConvertToNote={handleConvertToNote}
          comments={commentsApi.threads}
          commentsOpen={commentsOpen}
          onToggleComments={toggleComments}
          onAddComment={async (text, anchor) => { await commentsApi.add(text, anchor); scheduleAutoCommit(); }}
          onReplyComment={async (id, text) => { await commentsApi.reply(id, text); scheduleAutoCommit(); }}
          onResolveComment={async (id, resolved) => { await commentsApi.resolve(id, resolved); scheduleAutoCommit(); }}
          onDeleteComment={async (id) => { await commentsApi.remove(id); scheduleAutoCommit(); }}
        />

        {terminalMounted && (
          <aside className={styles.rightPane} style={rightVisible ? undefined : { display: "none" }}>
            <TerminalPane ref={termRef} cwd={vault.path} visible={rightVisible} command={terminalCommand} />
          </aside>
        )}

        {showSettings && (
          <SettingsView
            vault={vault}
            onClose={() => { setShowSettings(false); loadSettings(); focusEditor(); }}
            onLeaveVault={onLeaveVault}
          />
        )}

        {showMarketplace && (
          <MarketplaceView
            onClose={() => { setShowMarketplace(false); focusEditor(); }}
            onChanged={() => { refresh(); scheduleAutoCommit(); }}
          />
        )}
      </div>

      {switcher && (
        <QuickSwitcher
          notes={notes}
          recent={recentNotes}
          initialQuery={switcher === "actions" ? ">" : ""}
          onSelect={(p) => openNote(p)}
          onClose={() => { setSwitcher(null); focusEditor(); }}
          onNewNote={() => handleNewNote()}
          onToday={handleToday}
          onOpenGraph={() => setShowGraph("global")}
          onNewFromTemplate={handleNewFromTemplate}
          onNewCollection={handleNewCollection}
          onSync={handleSync}
          onToggleTheme={handleToggleTheme}
          onOpenSettings={() => setShowSettings(true)}
          onOpenMarketplace={() => setShowMarketplace(true)}
          onShortcutHelp={() => setShowShortcuts(true)}
          onLogToday={() => setShowLogToday(true)}
          onQuickCapture={() => setShowCapture(true)}
          onToggleSidebar={toggleLeft}
          onToggleTerminal={handleToggleTerminal}
          onToggleMonk={toggleMonk}
          onFocusSidebar={() => actionsRef.current?.["focus-sidebar"]()}
          onToggleProperties={() => editorRef.current?.toggleProperties()}
          onFindInNote={note ? () => editorRef.current?.openFind() : undefined}
          onToggleOutline={() => editorRef.current?.toggleOutline()}
          onToggleComments={note ? toggleComments : undefined}
          onComment={note ? () => editorRef.current?.commentOnSelection() : undefined}
          onPublish={() => setShowPublish(true)}
          onImport={() => setShowImport(true)}
          onCheckForUpdates={() => setShowUpdate(true)}
          onTogglePublic={note ? () => editorRef.current?.togglePublic() : undefined}
          isPublic={note?.frontmatter["publish"] === true}
          onToggleFullWidth={note ? () => editorRef.current?.toggleFullWidth() : undefined}
          isFullWidth={note?.frontmatter["width"] === "full"}
          hasRemote={vault.has_remote}
        />
      )}

      {showLogToday && (
        <LogTodayModal onClose={() => { setShowLogToday(false); focusEditor(); }} onChanged={() => { refresh(); scheduleAutoCommit(); }} />
      )}

      {showPublish && (
        <PublishModal
          vault={vault}
          onClose={() => { setShowPublish(false); focusEditor(); }}
          onOpenNote={(p) => openNote(p)}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => { setShowImport(false); focusEditor(); }}
          onChanged={() => { refresh(); scheduleAutoCommit(); }}
          onOpenNote={(p) => openNote(p)}
        />
      )}

      {showUpdate && (
        <UpdateModal onClose={() => { setShowUpdate(false); focusEditor(); }} />
      )}

      {showCapture && (
        <QuickCapture
          onCapture={handleQuickCapture}
          onClose={() => setShowCapture(false)}
        />
      )}

      {showShortcuts && (
        <ShortcutOverlay
          onClose={() => { setShowShortcuts(false); focusEditor(); }}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      {openTag && (
        <TagView
          tag={openTag}
          tags={tags}
          notes={notes}
          onOpenTag={setOpenTag}
          onNavigate={(path) => { setOpenTag(null); openNote(path); }}
          onClose={() => { setOpenTag(null); focusEditor(); }}
        />
      )}

      {showGraph && (
        <GraphView
          notes={notes}
          currentPath={note?.path ?? null}
          initialMode={showGraph}
          onNavigate={(path) => { setSelectedPath(path); setShowGraph(false); }}
          onClose={() => setShowGraph(false)}
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

/** Is the key event aimed at a text field, where a bare letter is just typing? */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}
