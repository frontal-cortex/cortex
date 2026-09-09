import {
  useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle,
  KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, Fragment,
} from "react";
import { shortcutFor, SHORTCUTS, ShortcutId, isMac } from "../../lib/keymap";
import { NoteEntry, SearchHit, VaultStatus, AgentBranch, CommitEntry, TrashEntry, TagNode } from "../../lib/commands";
import { commands } from "../../lib/commands";
import {
  buildTree, buildCollectionNodes, attachCollections, flattenTree, displayTitle, relativeTime,
  ExplorerSort, SORT_FIELDS,
} from "../../lib/fileTree";
import { FileTree, LeafRow, BranchRow, ActionRow, TreeActions, A11yFor, NEW_NOTE_HINT, COLLECTION_DRAG } from "./FileTree";
import { flattenTags } from "../../lib/tags";
import { CommitDiffModal } from "./CommitDiffModal";
import { Snippet } from "./Snippet";
import {
  GettingStarted, GettingStartedStep, loadGettingStartedDismissed, saveGettingStartedDismissed,
} from "./GettingStarted";
import { TreeRow, useRovingRows, useTypeAhead } from "./treeRows";
import {
  CloseIcon, MinusIcon, StarFilledIcon, PlusIcon, SearchIcon, GraphIcon, GearIcon, ChevronRightIcon,
  FolderPlusIcon, FileIcon, DatabaseIcon, TrashIcon, SparkleIcon, TagIcon, SortIcon,
} from "./icons";
import styles from "./LeftPanel.module.css";
// The sort menu borrows the context menu's look, so every popover in the tree matches.
import menuStyles from "./FileTree.module.css";

interface Props {
  notes: NoteEntry[];
  dirs: string[];
  /** The vault's tag tree (frontmatter + inline `#tags`, nested by `/`). */
  tags: TagNode[];
  /** Open the tag page — every note carrying the tag or one of its children. */
  onOpenTag: (tag: string) => void;
  /** Recently opened note paths, most recent first (the Recent section). */
  recent: string[];
  /** Order of notes in the tree — `explorer_sort` in settings, set from the Notes header. */
  explorerSort: ExplorerSort;
  onSetExplorerSort: (sort: ExplorerSort) => void;
  selectedPath: string | null;
  status: VaultStatus | null;
  agentBranches: AgentBranch[];
  commits: CommitEntry[];
  favorites: string[];
  onSelect: (path: string) => void;
  onNewNote: (parentFolder?: string) => void;
  onDeleteNote: (path: string) => void;
  onTurnIntoDatabase: (path: string) => void;
  onToggleFavorite: (path: string) => void;
  isFavorite: (path: string) => boolean;
  onOpenGraph: () => void;
  onNewFromTemplate: (templateName: string) => void;
  onNewCollection: () => void;
  onOpenCollection: (name: string) => void;
  onOpenSettings: () => void;
  /** Opens the template marketplace (the Templates section's "Get more" and the Getting-started step). */
  onOpenMarketplace?: () => void;
  onCommit: (message: string) => Promise<void>;
  onApplyBranch: (name: string) => void;
  onDiscardBranch: (name: string) => void;
  onRefresh: () => void;
  trash: TrashEntry[];
  onRestoreTrashed: (id: string) => void;
  onDeleteTrashed: (id: string) => void;
  onEmptyTrash: () => void;
  /** Escape on a focused tree row — Shell uses it to hand focus back to the editor. */
  onEscape?: () => void;
  /** Opens the command palette. Without it the panel replays the registered
   *  shortcut, which Shell's global handler already understands. */
  onOpenCommandPalette?: () => void;
}

/** What Shell can ask of the panel imperatively. */
export interface LeftPanelHandle {
  /** Focus the tree on the open note's row, or the first row. */
  focus(): void;
}

type SectionId = "favorites" | "recent" | "notes" | "tags" | "templates" | "trash";

const SECTION_DEFAULT_OPEN: Record<SectionId, boolean> = {
  favorites: true, recent: false, notes: true, tags: true, templates: false, trash: false,
};

export const LeftPanel = forwardRef<LeftPanelHandle, Props>(function LeftPanel({
  notes, dirs, tags, onOpenTag, recent, explorerSort, onSetExplorerSort,
  selectedPath, status, agentBranches, commits, favorites,
  onSelect, onNewNote, onDeleteNote, onTurnIntoDatabase, onToggleFavorite, isFavorite, onOpenGraph,
  onNewFromTemplate, onNewCollection, onOpenCollection, onOpenSettings, onOpenMarketplace,
  onCommit, onApplyBranch, onDiscardBranch, onRefresh,
  trash, onRestoreTrashed, onDeleteTrashed, onEmptyTrash,
  onEscape, onOpenCommandPalette,
}, ref) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [newFolderIn, setNewFolderIn] = useState<string | null>(null);
  const [diffHash, setDiffHash] = useState<string | null>(null);
  // Proposal under review — its diff is shown before Apply/Discard are offered.
  const [review, setReview] = useState<AgentBranch | null>(null);
  // Notes section root drop zone
  const [notesSectionDragOver, setNotesSectionDragOver] = useState(false);
  // The explorer sort menu, anchored where the header's sort button was clicked.
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);

  // Open/closed state for sections and folders lives here rather than in the
  // rows, because the keyboard walks a flat list of *visible* rows and that
  // list has to be derived from the same state the renderer reads.
  const [sectionOpen, setSectionOpen] = useState<Record<SectionId, boolean>>(SECTION_DEFAULT_OPEN);
  const [dirOpen, setDirOpen] = useState<Record<string, boolean>>({});
  // Nested tags fold like folders; every tag starts closed.
  const [tagOpen, setTagOpen] = useState<Record<string, boolean>>({});
  const [gettingStartedDismissed, setGettingStartedDismissed] = useState(loadGettingStartedDismissed);

  const changedCount = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0);
  const isDirty = changedCount > 0;

  // Debounced backend search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) { setSearchResults(null); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        setSearchResults(await commands.searchNotes(query));
      } catch {
        const q = query.toLowerCase();
        setSearchResults(notes.filter((n) =>
          n.title.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)),
        ).map((n) => ({ ...n, snippet: "" })));
      }
    }, 200);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, notes]);

  // ── Folder open state ──────────────────────────────────────────────────
  // Top-level folders start open, nested ones closed; anything the user
  // touched keeps its state. Opening a note from elsewhere (quick switcher, a
  // wiki link) reveals it by opening every folder above it.
  const isDirOpen = useCallback(
    (path: string, depth: number) => dirOpen[path] ?? depth === 0,
    [dirOpen],
  );
  const toggleDir = useCallback((path: string, open?: boolean) => {
    setDirOpen((prev) => {
      const depth = path.split("/").filter(Boolean).length - 2;
      const current = prev[path] ?? depth === 0;
      const next = open ?? !current;
      return next === current ? prev : { ...prev, [path]: next };
    });
  }, []);
  const toggleTag = useCallback((path: string, open?: boolean) => {
    setTagOpen((prev) => {
      const next = open ?? !prev[path];
      return next === !!prev[path] ? prev : { ...prev, [path]: next };
    });
  }, []);
  const toggleSection = useCallback((id: SectionId, open?: boolean) => {
    setSectionOpen((prev) => {
      const next = open ?? !prev[id];
      return next === prev[id] ? prev : { ...prev, [id]: next };
    });
  }, []);

  useEffect(() => {
    if (!selectedPath) return;
    const parts = selectedPath.split("/");
    const ancestors: string[] = [];
    for (let i = 2; i < parts.length; i++) ancestors.push(parts.slice(0, i).join("/") + "/");
    if (ancestors.length === 0) return;
    setDirOpen((prev) => {
      if (ancestors.every((a) => prev[a])) return prev;
      const next = { ...prev };
      for (const a of ancestors) next[a] = true;
      return next;
    });
  }, [selectedPath]);

  // ── File operations ────────────────────────────────────────────────────

  const handleDeleteFolder = useCallback(async (path: string) => {
    const name = path.replace(/\/$/, "").split("/").pop() ?? path;
    if (!window.confirm(`Delete folder "${name}" and all notes inside? This cannot be undone.`)) return;
    await commands.deleteFolder(path);
    onRefresh();
  }, [onRefresh]);

  const handleMoveNote = useCallback(async (fromPath: string, toDir: string) => {
    try {
      const newPath = await commands.moveNote(fromPath, toDir);
      onRefresh();
      // Re-select the note at its new path
      onSelect(newPath);
    } catch (e) {
      window.alert(String(e));
    }
  }, [onRefresh, onSelect]);

  // Rename the file and set its title to match; inbound links follow (one
  // core call, one commit when auto-commit is on).
  const handleRenameFile = useCallback(async (path: string) => {
    const stem = path.split("/").pop()!.replace(/\.md$/, "");
    const current = notes.find((n) => n.path === path)?.title || stem.replace(/-/g, " ");
    const input = window.prompt("Rename", current)?.trim();
    if (!input) return;
    const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const newPath = dir ? `${dir}/${slug}.md` : `${slug}.md`;
    try {
      await commands.renameNote(path, newPath, input);
      onRefresh();
      if (selectedPath === path) onSelect(newPath);
    } catch (e) { window.alert(String(e)); }
  }, [notes, onRefresh, onSelect, selectedPath]);

  const handleDuplicateFile = useCallback(async (path: string) => {
    try {
      const newPath = await commands.duplicateNote(path);
      onRefresh();
      onSelect(newPath);
    } catch (e) { window.alert(String(e)); }
  }, [onRefresh, onSelect]);

  const handleRevealFile = useCallback((path: string) => {
    commands.revealPath(path).catch((e) => window.alert(String(e)));
  }, []);

  const handleCreateFolder = useCallback(async (parentPath: string, name: string) => {
    const cleaned = name.trim().replace(/\/+/g, "");
    if (!cleaned) return;
    const fullPath = `${parentPath.replace(/\/$/, "")}/${cleaned}`;
    await commands.createFolder(fullPath);
    setNewFolderIn(null);
    onRefresh();
  }, [onRefresh]);

  const requestNewFolder = useCallback((parentPath: string) => {
    if (parentPath === "notes/") toggleSection("notes", true);
    else toggleDir(parentPath, true);
    setNewFolderIn(parentPath);
  }, [toggleDir, toggleSection]);

  // One tree: folders, then the collections that live at each level (by their
  // page's `parent:`, top level otherwise), then notes. Rows never appear.
  const notesTree = useMemo(() => {
    const { roots, underFolder } = buildCollectionNodes(notes);
    return attachCollections(buildTree(notes, "notes/", dirs, explorerSort), roots, underFolder);
  }, [notes, dirs, explorerSort]);
  const templateTree = useMemo(() => buildTree(notes, "templates/", [], explorerSort), [notes, explorerSort]);
  // Recent notes that still exist, in order — a renamed or trashed one drops out.
  const recentNotes = useMemo(() => {
    const byPath = new Map(notes.map((n) => [n.path, n]));
    return recent.map((p) => byPath.get(p)).filter((n): n is NoteEntry => !!n);
  }, [notes, recent]);
  const collectionCount = useMemo(() => new Set(notes.map((n) => n.path.match(/^collections\/([^/]+)\//)?.[1]).filter(Boolean)).size, [notes]);

  const handleDeleteCollection = useCallback(async (name: string) => {
    if (!window.confirm(`Move the collection "${name}" to the trash? Its rows, page and row templates go in one by one and can each be restored.`)) return;
    try { await commands.trashCollection(name); onRefresh(); } catch (e) { window.alert(String(e)); }
  }, [onRefresh]);
  const handleRenameCollection = useCallback(async (name: string) => {
    const path = `collections/${name}/_index.md`;
    try {
      const page = await commands.readNote(path);
      const current = typeof page.frontmatter["title"] === "string" ? (page.frontmatter["title"] as string) : name;
      const title = window.prompt("Collection title", current)?.trim();
      if (!title || title === current) return;
      await commands.writeNote(path, { ...page, frontmatter: { ...page.frontmatter, title } });
      onRefresh();
    } catch (e) { window.alert(String(e)); }
  }, [onRefresh]);
  // Nesting is one line of frontmatter on the collection's page; nothing moves on disk.
  const handleMoveCollection = useCallback(async (name: string, parent: string | null) => {
    const path = `collections/${name}/_index.md`;
    try {
      const page = await commands.readNote(path);
      const fm = { ...page.frontmatter };
      const target = parent?.replace(/\/$/, "") ?? null;
      if (target && target !== "notes") fm["parent"] = target; else delete fm["parent"];
      await commands.writeNote(path, { ...page, frontmatter: fm });
      onRefresh();
    } catch (e) { window.alert(String(e)); }
  }, [onRefresh]);

  const treeActions = useMemo<TreeActions>(() => ({
    newFolderIn,
    onNewFolderRequest: requestNewFolder,
    onNewFolderSubmit: handleCreateFolder,
    onNewFolderCancel: () => setNewFolderIn(null),
    onNewNoteInFolder: (parentPath: string) => onNewNote(parentPath),
    onDeleteFolder: handleDeleteFolder,
    onMoveNote: handleMoveNote,
    onRenameFile: handleRenameFile,
    onDuplicateFile: handleDuplicateFile,
    onRevealFile: handleRevealFile,
    onDeleteFile: onDeleteNote,
    onTurnIntoDatabase,
    onToggleFavorite,
    isFavorite,
    onOpenCollection,
    onRenameCollection: handleRenameCollection,
    onDeleteCollection: handleDeleteCollection,
    onMoveCollection: handleMoveCollection,
  }), [newFolderIn, requestNewFolder, handleCreateFolder, onNewNote, handleDeleteFolder, handleMoveNote,
       handleRenameFile, handleDuplicateFile, handleRevealFile, onDeleteNote, onTurnIntoDatabase, onToggleFavorite, isFavorite,
       onOpenCollection, handleRenameCollection, handleDeleteCollection, handleMoveCollection]);

  const templateActions = useMemo<TreeActions>(() => ({
    ...treeActions, onNewFolderRequest: () => {}, newFolderIn: null,
  }), [treeActions]);

  const notesCount = useMemo(() => notes.filter((n) => n.path.startsWith("notes/")).length, [notes]);
  const tagCount = useMemo(() => flattenTags(tags).length, [tags]);

  // ── Getting started ────────────────────────────────────────────────────

  const openCommandPalette = useCallback(() => {
    if (onOpenCommandPalette) onOpenCommandPalette();
    else replayShortcut("command-palette");
  }, [onOpenCommandPalette]);

  // "Try a template": the marketplace when there is one to browse, else the
  // vault's own templates (or a fresh one).
  const tryTemplate = useCallback(() => {
    if (onOpenMarketplace) { onOpenMarketplace(); return; }
    const files = templateTree.filter((n) => n.type === "file");
    const pick = files.find((n) => n.path === "templates/note.md") ?? files[0];
    if (pick) onNewFromTemplate(pick.path.slice("templates/".length));
    else onNewNote("templates");
  }, [templateTree, onNewFromTemplate, onNewNote, onOpenMarketplace]);

  const openAgentsDoc = useCallback(() => {
    if (notes.some((n) => n.path === "AGENTS.md")) onSelect("AGENTS.md");
    else commands.revealPath("AGENTS.md").catch(() => window.alert("This vault has no AGENTS.md yet."));
  }, [notes, onSelect]);

  const dismissGettingStarted = useCallback(() => {
    saveGettingStartedDismissed();
    setGettingStartedDismissed(true);
  }, []);

  const showGettingStarted = notesCount <= 1 && !gettingStartedDismissed;
  const gettingStartedSteps = useMemo<GettingStartedStep[]>(() => [
    { id: "gs:new",      label: "Create your first note",     hint: shortcutFor("new-note"),        run: () => onNewNote() },
    { id: "gs:palette",  label: "Open the command palette",   hint: shortcutFor("command-palette"), run: openCommandPalette },
    { id: "gs:template", label: "Try a template",                                                   run: tryTemplate },
    { id: "gs:agents",   label: "Ask an agent",               hint: "AGENTS.md",                    run: openAgentsDoc },
  ], [onNewNote, openCommandPalette, tryTemplate, openAgentsDoc]);

  // ── Row list ───────────────────────────────────────────────────────────
  // The keyboard's view of the sidebar, in render order. Anything rendered
  // as a row below must be pushed here under the same id, and vice versa.

  const rows = useMemo<TreeRow[]>(() => {
    const out: TreeRow[] = [];

    if (searchResults) {
      for (const n of searchResults) {
        out.push({ id: `result:${n.path}`, kind: "note", label: displayTitle(n), depth: 0, parentId: null, path: n.path, folder: dirOf(n.path) });
      }
      return out;
    }

    const section = (id: SectionId, label: string, folder?: string) => {
      const rowId = `section:${id}`;
      out.push({ id: rowId, kind: "section", label, depth: 0, parentId: null, expanded: sectionOpen[id], folder });
      return sectionOpen[id] ? rowId : null;
    };
    const pushTree = (tree: ReturnType<typeof buildTree>, parentId: string, rootFolder: string) => {
      for (const { node, depth, parentPath } of flattenTree(tree, isDirOpen)) {
        const pid = parentPath ?? parentId;
        if (node.type === "dir") {
          out.push({ id: node.path, kind: "dir", label: node.name, depth: depth + 1, parentId: pid, expanded: isDirOpen(node.path, depth), path: node.path, folder: node.path });
        } else if (node.type === "collection") {
          const c = node.collection;
          out.push({
            id: node.path, kind: "collection", label: node.name, depth: depth + 1, parentId: pid, path: node.path,
            expanded: node.children.length > 0 ? isDirOpen(node.path, depth) : undefined,
            folder: parentPath && !parentPath.startsWith("collections/") ? parentPath : rootFolder,
            run: () => onOpenCollection(c), remove: () => handleDeleteCollection(c),
          });
        } else {
          out.push({ id: node.path, kind: "note", label: node.name, depth: depth + 1, parentId: pid, path: node.path, folder: parentPath ?? rootFolder });
        }
      }
    };

    if (favorites.length > 0) {
      const pid = section("favorites", "Favorites");
      if (pid) for (const path of favorites) {
        const note = notes.find((n) => n.path === path);
        if (!note) continue;
        out.push({
          id: `fav:${path}`, kind: "note", label: displayTitle(note), depth: 1, parentId: pid, path, folder: dirOf(path),
          remove: () => onToggleFavorite(path),
        });
      }
    }

    if (recentNotes.length > 0) {
      const pid = section("recent", "Recent");
      if (pid) for (const note of recentNotes) {
        out.push({ id: `recent:${note.path}`, kind: "note", label: displayTitle(note), depth: 1, parentId: pid, path: note.path, folder: dirOf(note.path) });
      }
    }

    {
      const pid = section("notes", "Notes", "notes/");
      if (pid) {
        if (showGettingStarted) {
          for (const s of gettingStartedSteps) {
            out.push({ id: s.id, kind: "action", label: s.label, depth: 1, parentId: pid, run: s.run, remove: dismissGettingStarted, folder: "notes/" });
          }
        }
        if (notesTree.length === 0 && newFolderIn !== "notes/") {
          out.push({ id: "action:notes-empty", kind: "action", label: "Create a note", depth: 1, parentId: pid, run: () => onNewNote(), folder: "notes/" });
        } else {
          pushTree(notesTree, pid, "notes/");
        }
      }
    }

    if (tagCount > 0) {
      const pid = section("tags", "Tags");
      const pushTags = (nodes: TagNode[], parentId: string, depth: number) => {
        for (const t of nodes) {
          const id = `tag:${t.path}`;
          const nested = t.children.length > 0;
          out.push({
            id, kind: "tag", label: t.name, depth, parentId, path: t.path,
            expanded: nested ? !!tagOpen[t.path] : undefined,
            run: () => onOpenTag(t.path),
          });
          if (nested && tagOpen[t.path]) pushTags(t.children, id, depth + 1);
        }
      };
      if (pid) pushTags(tags, pid, 1);
    }

    {
      const pid = section("templates", "Templates", "templates/");
      if (pid) {
        if (templateTree.length === 0) {
          out.push({ id: "action:templates-empty", kind: "action", label: "Create a template", depth: 1, parentId: pid, run: () => onNewNote("templates"), folder: "templates/" });
        } else {
          pushTree(templateTree, pid, "templates/");
        }
        if (onOpenMarketplace) {
          out.push({ id: "action:templates-more", kind: "action", label: "Get more templates", depth: 1, parentId: pid, run: onOpenMarketplace, folder: "templates/" });
        }
      }
    }

    if (trash.length > 0) {
      const pid = section("trash", "Trash");
      if (pid) {
        for (const t of trash) {
          out.push({ id: `trash:${t.id}`, kind: "trash", label: t.title || "Untitled", depth: 1, parentId: pid, run: () => onRestoreTrashed(t.id), remove: () => onDeleteTrashed(t.id) });
        }
        out.push({ id: "action:empty-trash", kind: "action", label: "Empty trash", depth: 1, parentId: pid, run: onEmptyTrash });
      }
    }

    return out;
  }, [searchResults, sectionOpen, isDirOpen, favorites, recentNotes, notes, showGettingStarted, gettingStartedSteps, dismissGettingStarted, onOpenMarketplace,
      notesTree, newFolderIn, templateTree, trash, onToggleFavorite, onNewNote, onNewCollection, onOpenCollection, handleDeleteCollection,
      onRestoreTrashed, onDeleteTrashed, onEmptyTrash, tags, tagCount, tagOpen, onOpenTag]);

  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const { containerRef, activeId, focusRow, rowA11y } = useRovingRows(rows, selectedPath);
  const typeAhead = useTypeAhead();

  const a11y = useCallback<A11yFor>((id, selected) => {
    const row = rowsById.get(id);
    return row ? rowA11y(row, selected) : undefined;
  }, [rowsById, rowA11y]);

  useImperativeHandle(ref, () => ({
    focus() {
      const selected = selectedPath && rowsById.has(selectedPath) ? selectedPath : null;
      focusRow(selected ?? activeId ?? rows[0]?.id ?? null);
    },
  }), [selectedPath, rowsById, focusRow, activeId, rows]);

  // ── Keyboard ───────────────────────────────────────────────────────────

  const activate = useCallback((row: TreeRow) => {
    switch (row.kind) {
      case "section": toggleSection(row.id.slice("section:".length) as SectionId); break;
      case "dir": toggleDir(row.path!); break;
      case "note": onSelect(row.path!); break;
      default: row.run?.();
    }
  }, [toggleSection, toggleDir, onSelect]);

  const setExpanded = useCallback((row: TreeRow, open: boolean) => {
    if (row.kind === "section") toggleSection(row.id.slice("section:".length) as SectionId, open);
    else if (row.kind === "tag" && row.expanded !== undefined) toggleTag(row.path!, open);
    else if (row.kind === "dir" || (row.kind === "collection" && row.expanded !== undefined)) toggleDir(row.path!, open);
  }, [toggleSection, toggleDir, toggleTag]);

  const handleTreeKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // App-level chords belong to Shell; typing in an inline input is typing.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

    const idx = activeId ? rows.findIndex((r) => r.id === activeId) : -1;
    const row = idx >= 0 ? rows[idx] : undefined;
    const go = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (r) focusRow(r.id);
    };
    // Focus a neighbour before the row disappears, so focus never drops to <body>.
    const removeRow = (r: TreeRow) => {
      const neighbour = rows[idx + 1] ?? rows[idx - 1];
      if (neighbour) focusRow(neighbour.id);
      if (r.remove) r.remove();
      else if (r.kind === "note" && r.path) onDeleteNote(r.path);
    };

    let handled = true;
    switch (e.key) {
      case "ArrowDown": case "j": go(idx + 1); break;
      case "ArrowUp":   case "k": go(idx - 1); break;
      case "Home": go(0); break;
      case "End":  go(rows.length - 1); break;
      case "ArrowRight": case "l": {
        if (!row) { go(0); break; }
        if (row.expanded === false) setExpanded(row, true);
        else if (row.expanded === true) {
          const next = rows[idx + 1];
          if (next && next.parentId === row.id) focusRow(next.id);
        }
        break;
      }
      case "ArrowLeft": case "h": {
        if (!row) break;
        if (row.expanded === true) setExpanded(row, false);
        else if (row.parentId) focusRow(row.parentId);
        break;
      }
      case "Enter": if (row) activate(row); break;
      // Enter on a tag opens its page; Space folds it (a tag with children), like a folder.
      case " ": if (row?.kind === "tag") { if (row.expanded !== undefined) setExpanded(row, !row.expanded); } else if (row && row.expanded !== undefined) activate(row); break;
      case "n": onNewNote(row?.folder); break;
      case "Delete": case "Backspace": if (row) removeRow(row); break;
      case "f": if (row?.kind === "note" && row.path) onToggleFavorite(row.path); break;
      case "/": searchRef.current?.focus(); searchRef.current?.select(); break;
      case "Escape": target.blur(); onEscape?.(); break;
      default: {
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const hit = typeAhead(rows, idx, e.key);
          if (hit) focusRow(hit.id);
        } else {
          handled = false;
        }
      }
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  const handleSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      focusRow(activeId ?? rows[0]?.id ?? null);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(rows[0]?.id ?? null);
    } else if (e.key === "Enter" && searchResults?.[0]) {
      onSelect(searchResults[0].path);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const sectionProps = (id: SectionId) => ({
    a11y: a11y(`section:${id}`),
    open: sectionOpen[id],
    onToggle: () => toggleSection(id),
  });

  return (
    <div className={styles.root}>
      {/* ── Search ──────────────────────────────────────────────── */}
      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <SearchIcon size={13} />
          <input
            ref={searchRef}
            className={styles.searchInput}
            placeholder={`Search…  /`}
            title={`Search notes (/ from the tree · ${shortcutFor("quick-switcher")} to jump anywhere)`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {query && <button className={styles.clearBtn} tabIndex={-1} onClick={() => setQuery("")} title="Clear search"><CloseIcon size={13} /></button>}
        </div>
      </div>

      {/* ── Tree / Search results ────────────────────────────────── */}
      <div
        ref={containerRef}
        className={styles.treeArea}
        role="tree"
        aria-label="Sidebar"
        onKeyDown={handleTreeKeyDown}
      >
        {searchResults ? (
          <div className={styles.searchResults}>
            {searchResults.length === 0 && <p className={styles.empty}>No matches for "{query}"</p>}
            {searchResults.map((n) => (
              <Fragment key={n.path}>
                <LeafRow
                  id={`result:${n.path}`}
                  a11y={a11y}
                  depth={-1}
                  selected={n.path === selectedPath}
                  icon={n.icon ? <span className={styles.emoji}>{n.icon}</span> : <FileIcon />}
                  label={displayTitle(n)}
                  hint={dirOf(n.path).replace(/\/$/, "")}
                  title={n.path}
                  onClick={() => onSelect(n.path)}
                />
                {n.snippet && (
                  <div className={styles.resultSnippet} onClick={() => onSelect(n.path)}>
                    <Snippet text={n.snippet} />
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        ) : (
          <>
            {favorites.length > 0 && (
              <Section {...sectionProps("favorites")} label="Favorites" count={favorites.length}>
                {favorites.map((path) => {
                  const note = notes.find((n) => n.path === path);
                  if (!note) return null;
                  return (
                    <LeafRow
                      key={path}
                      id={`fav:${path}`}
                      a11y={a11y}
                      depth={0}
                      selected={path === selectedPath}
                      icon={note.icon ? <span className={styles.emoji}>{note.icon}</span> : <FileIcon />}
                      label={displayTitle(note)}
                      title={`${path} · Delete unpins`}
                      onClick={() => onSelect(path)}
                      trailing={
                        <button
                          className={styles.favStar}
                          tabIndex={-1}
                          onClick={(e) => { e.stopPropagation(); onToggleFavorite(path); }}
                          title="Remove from favorites (f)"
                        ><StarFilledIcon size={12} /></button>
                      }
                    />
                  );
                })}
              </Section>
            )}

            {recentNotes.length > 0 && (
              <Section {...sectionProps("recent")} label="Recent" count={recentNotes.length}>
                {recentNotes.map((note) => (
                  <LeafRow
                    key={note.path}
                    id={`recent:${note.path}`}
                    a11y={a11y}
                    depth={0}
                    selected={note.path === selectedPath}
                    icon={note.icon ? <span className={styles.emoji}>{note.icon}</span> : <FileIcon />}
                    label={displayTitle(note)}
                    hint={dirOf(note.path).replace(/\/$/, "")}
                    title={note.path}
                    onClick={() => onSelect(note.path)}
                  />
                ))}
              </Section>
            )}

            <Section
              {...sectionProps("notes")}
              label="Notes"
              count={notesCount + collectionCount}
              actions={[
                { title: NEW_NOTE_HINT, icon: <PlusIcon size={13} />, run: () => onNewNote() },
                { title: "New folder", icon: <FolderPlusIcon size={13} />, run: () => requestNewFolder("notes/") },
                { title: "New collection", icon: <DatabaseIcon size={13} />, run: onNewCollection },
                {
                  title: `Sort: ${SORT_FIELDS.find((f) => f.value === explorerSort.field)?.label} ${explorerSort.dir === "asc" ? "↑" : "↓"}`,
                  icon: <SortIcon size={13} />,
                  run: (e) => setSortMenu({ x: e.clientX, y: e.clientY }),
                },
                { title: `Graph view (${shortcutFor("graph")})`, icon: <GraphIcon size={12} />, run: onOpenGraph },
              ]}
              dropActive={notesSectionDragOver}
              onDragOver={(e) => { e.preventDefault(); setNotesSectionDragOver(true); }}
              onDragLeave={() => setNotesSectionDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setNotesSectionDragOver(false);
                const path = e.dataTransfer.getData("text/plain");
                if (path.startsWith(COLLECTION_DRAG)) handleMoveCollection(path.slice(COLLECTION_DRAG.length), null);
                else if (path) handleMoveNote(path, "notes/");
              }}
            >
              {showGettingStarted && (
                <GettingStarted steps={gettingStartedSteps} a11y={a11y} onDismiss={dismissGettingStarted} />
              )}
              {notesTree.length === 0 && newFolderIn !== "notes/"
                ? <ActionRow
                    id="action:notes-empty"
                    a11y={a11y}
                    depth={0}
                    icon={<PlusIcon size={12} />}
                    text="No notes"
                    action="Create one"
                    title={NEW_NOTE_HINT}
                    onClick={() => onNewNote()}
                  />
                : <FileTree
                    nodes={notesTree}
                    currentPath="notes/"
                    selectedPath={selectedPath}
                    isDirOpen={isDirOpen}
                    onToggleDir={toggleDir}
                    actions={treeActions}
                    onSelect={onSelect}
                    a11y={a11y}
                  />}
            </Section>

            {tagCount > 0 && (
              <Section {...sectionProps("tags")} label="Tags" count={tagCount}>
                <TagTree nodes={tags} depth={0} tagOpen={tagOpen} onToggle={toggleTag} onOpen={onOpenTag} a11y={a11y} />
              </Section>
            )}

            <Section
              {...sectionProps("templates")}
              label="Templates"
              count={templateTree.length}
              actions={[
                ...(onOpenMarketplace ? [{ title: `Browse templates (${shortcutFor("marketplace")})`, icon: <SparkleIcon size={13} />, run: onOpenMarketplace }] : []),
                { title: "New template", icon: <PlusIcon size={13} />, run: () => onNewNote("templates") },
              ]}
            >
              {templateTree.length === 0
                ? <ActionRow
                    id="action:templates-empty"
                    a11y={a11y}
                    depth={0}
                    icon={<PlusIcon size={12} />}
                    text="No templates"
                    action="Create one"
                    title="A starting point for new notes"
                    onClick={() => onNewNote("templates")}
                  />
                : <FileTree
                    nodes={templateTree}
                    currentPath="templates/"
                    selectedPath={selectedPath}
                    isDirOpen={isDirOpen}
                    onToggleDir={toggleDir}
                    actions={templateActions}
                    onSelect={onSelect}
                    a11y={a11y}
                  />}
              {onOpenMarketplace && (
                <ActionRow
                  id="action:templates-more"
                  a11y={a11y}
                  depth={0}
                  icon={<SparkleIcon size={12} />}
                  action="Get more templates"
                  title="Browse the template marketplace — note templates and collections, installed as plain files"
                  onClick={onOpenMarketplace}
                />
              )}
            </Section>

            {trash.length > 0 && (
              <Section {...sectionProps("trash")} label="Trash" count={trash.length}>
                {trash.map((t) => (
                  <LeafRow
                    key={t.id}
                    id={`trash:${t.id}`}
                    a11y={a11y}
                    depth={0}
                    icon={<TrashIcon size={13} />}
                    label={t.title || "Untitled"}
                    title={`${t.original_path} · Enter restores · Delete removes permanently`}
                    onClick={() => onRestoreTrashed(t.id)}
                    trailing={
                      <>
                        <span className={styles.trashAction}>Restore</span>
                        <button
                          className={styles.trashDelete}
                          tabIndex={-1}
                          onClick={(e) => { e.stopPropagation(); onDeleteTrashed(t.id); }}
                          title="Delete permanently"
                        >
                          <CloseIcon size={12} />
                        </button>
                      </>
                    }
                  />
                ))}
                <ActionRow
                  id="action:empty-trash"
                  a11y={a11y}
                  depth={0}
                  action="Empty trash"
                  onClick={onEmptyTrash}
                />
              </Section>
            )}
          </>
        )}
      </div>

      {/* ── Git ─────────────────────────────────────────────────── */}
      <GitSection
        status={status}
        isDirty={isDirty}
        changedCount={changedCount}
        commits={commits}
        agentBranches={agentBranches}
        onCommit={onCommit}
        onDiscardBranch={onDiscardBranch}
        onCommitClick={setDiffHash}
        onReviewBranch={setReview}
      />

      {/* ── Footer (under the change log) ───────────────────────── */}
      <div className={styles.footer}>
        {onOpenMarketplace && (
          <button
            className={styles.footerBtn}
            onClick={onOpenMarketplace}
            title={`Browse templates (${shortcutFor("marketplace")}) — note templates and collections, installed as plain files`}
          >
            <SparkleIcon size={15} />
            <span>Templates</span>
          </button>
        )}
        <button className={styles.footerBtn} onClick={onOpenSettings} title={`Settings (${shortcutFor("settings")})`}>
          <GearIcon size={15} />
          <span>Settings</span>
        </button>
      </div>

      {sortMenu && (
        <SortMenu
          x={sortMenu.x}
          y={sortMenu.y}
          sort={explorerSort}
          onChange={onSetExplorerSort}
          onClose={() => setSortMenu(null)}
        />
      )}
      {review && (
        <CommitDiffModal
          branch={review}
          onClose={() => setReview(null)}
          onApply={() => onApplyBranch(review.name)}
          onDiscard={() => onDiscardBranch(review.name)}
        />
      )}
      {diffHash && (
        <CommitDiffModal hash={diffHash} onClose={() => setDiffHash(null)} />
      )}
    </div>
  );
});

// ── Section ───────────────────────────────────────────────────────────────────
// The header is itself a tree row (Enter/Space/arrows fold it); its buttons
// are hover affordances and stay out of the tab order.

interface SectionAction {
  title: string;
  icon: ReactNode;
  /** The click, for actions that anchor a menu to the button. */
  run: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}

function Section({
  a11y, label, count, open, onToggle, actions = [],
  dropActive, onDragOver, onDragLeave, onDrop, children,
}: {
  a11y: ReturnType<A11yFor>;
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  actions?: SectionAction[];
  dropActive?: boolean;
  onDragOver?: React.DragEventHandler;
  onDragLeave?: React.DragEventHandler;
  onDrop?: React.DragEventHandler;
  children: ReactNode;
}) {
  return (
    <div
      className={`${styles.section} ${dropActive ? styles.sectionDropTarget : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        {...a11y}
        className={styles.sectionHeader}
        onClick={onToggle}
        title={`${label} · ${count}`}
      >
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} aria-hidden>
          <ChevronRightIcon size={12} />
        </span>
        <span className={styles.sectionLabel}>{label}</span>
        <span className={styles.sectionCount}>{count}</span>
        {actions.length > 0 && (
          <div className={styles.sectionActions}>
            {actions.map((a) => (
              <button
                key={a.title}
                className={styles.sectionAction}
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); a.run(e); }}
                title={a.title}
              >
                {a.icon}
              </button>
            ))}
          </div>
        )}
      </div>
      {open && <div className={styles.sectionBody} role="group">{children}</div>}
    </div>
  );
}

// ── Explorer sort menu ────────────────────────────────────────────────────────
// Field and direction are separate picks, each written straight to
// `explorer_sort` in settings.yaml (so `cortex settings set` sees the same value).

function SortMenu({ x, y, sort, onChange, onClose }: {
  x: number;
  y: number;
  sort: ExplorerSort;
  onChange: (sort: ExplorerSort) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 220);
  const pick = (next: ExplorerSort) => { onChange(next); onClose(); };
  const check = (on: boolean) => <span className={menuStyles.ctxHint}>{on ? "✓" : ""}</span>;

  return (
    <div
      ref={ref}
      className={menuStyles.ctxMenu}
      style={{ left, top }}
      role="menu"
      aria-label="Sort notes by"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {SORT_FIELDS.map((f) => (
        <button key={f.value} className={menuStyles.ctxItem} role="menuitemradio" aria-checked={sort.field === f.value}
          onClick={() => pick({ ...sort, field: f.value })}>
          {f.label} {check(sort.field === f.value)}
        </button>
      ))}
      <div className={menuStyles.ctxSep} />
      <button className={menuStyles.ctxItem} role="menuitemradio" aria-checked={sort.dir === "asc"} onClick={() => pick({ ...sort, dir: "asc" })}>
        Ascending {check(sort.dir === "asc")}
      </button>
      <button className={menuStyles.ctxItem} role="menuitemradio" aria-checked={sort.dir === "desc"} onClick={() => pick({ ...sort, dir: "desc" })}>
        Descending {check(sort.dir === "desc")}
      </button>
    </div>
  );
}

// ── Tag tree ──────────────────────────────────────────────────────────────────
// `project/alpha` nests under `project`; a parent's count includes its
// children. Enter or a click opens the tag page; the chevron (or Space) folds.

function TagTree({ nodes, depth, tagOpen, onToggle, onOpen, a11y }: {
  nodes: TagNode[];
  depth: number;
  tagOpen: Record<string, boolean>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  a11y: A11yFor;
}) {
  return (
    <>
      {nodes.map((t) => (
        <BranchRow
          key={t.path}
          id={`tag:${t.path}`}
          a11y={a11y}
          depth={depth}
          open={!!tagOpen[t.path]}
          hasChildren={t.children.length > 0}
          icon={<TagIcon size={13} />}
          label={t.name}
          count={t.count}
          title={`#${t.path} · ${t.count} note${t.count === 1 ? "" : "s"} · Enter opens`}
          onToggle={() => onToggle(t.path)}
          onActivate={() => onOpen(t.path)}
        >
          <TagTree nodes={t.children} depth={depth + 1} tagOpen={tagOpen} onToggle={onToggle} onOpen={onOpen} a11y={a11y} />
        </BranchRow>
      ))}
    </>
  );
}

// ── Git section ───────────────────────────────────────────────────────────────

function GitSection({
  status, isDirty, changedCount, commits, agentBranches,
  onCommit, onDiscardBranch, onCommitClick, onReviewBranch,
}: {
  status: VaultStatus | null;
  isDirty: boolean;
  changedCount: number;
  commits: CommitEntry[];
  agentBranches: AgentBranch[];
  onCommit: (msg: string) => Promise<void>;
  onDiscardBranch: (name: string) => void;
  onCommitClick: (hash: string) => void;
  onReviewBranch: (branch: AgentBranch) => void;
}) {
  const [msg, setMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCommit = async () => {
    setCommitting(true);
    try { await onCommit(msg.trim() || "Update notes"); setMsg(""); setExpanded(false); }
    finally { setCommitting(false); }
  };

  return (
    <div className={styles.gitSection}>
      <div className={styles.gitStatus}>
        <span className={styles.statusDot} style={{ background: isDirty ? "var(--git-dirty)" : "var(--git-clean)" }} />
        <span className={styles.statusText}>{isDirty ? `${changedCount} changed` : "Clean"}</span>
        {(status?.ahead ?? 0) > 0 && <span className={styles.pill}>{status!.ahead}↑</span>}
        {(status?.behind ?? 0) > 0 && <span className={styles.pill}>{status!.behind}↓</span>}
        {isDirty && (
          <button className={styles.commitToggle} onClick={() => setExpanded((x) => !x)}>
            {expanded ? <MinusIcon size={12} /> : "Commit"}
          </button>
        )}
      </div>

      {isDirty && expanded && (
        <div className={styles.commitForm}>
          <input
            className={styles.commitInput}
            placeholder="Commit message…"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCommit()}
            autoFocus
          />
          {status && (
            <div className={styles.changedFiles}>
              {[...status.staged, ...status.unstaged, ...status.untracked].slice(0, 4).map((f) => (
                <span key={f} className={styles.changedFile}>{f.split("/").pop()}</span>
              ))}
              {changedCount > 4 && <span className={styles.changedFile}>+{changedCount - 4} more</span>}
            </div>
          )}
          <button className={styles.commitBtn} onClick={handleCommit} disabled={committing}>
            {committing ? "Committing…" : "Commit all"}
          </button>
        </div>
      )}

      {agentBranches.map((b) => (
        <div key={b.name} className={styles.agentBranch} title={`${b.name}${b.remote ? " (on origin)" : ""} · ${b.commit_count} commit${b.commit_count === 1 ? "" : "s"}`}>
          <span className={styles.agentDot}>●</span>
          <button className={styles.agentDesc} onClick={() => onReviewBranch(b)}>{b.description}</button>
          <button className={styles.applyBtn} onClick={() => onReviewBranch(b)}>Review</button>
          <button className={styles.discardBtn} onClick={() => onDiscardBranch(b.name)} title="Discard proposal"><CloseIcon size={12} /></button>
        </div>
      ))}

      {commits.length > 0 && (
        <div className={styles.commitLog}>
          {commits.map((c) => (
            <button
              key={c.hash}
              className={styles.commitRow}
              onClick={() => onCommitClick(c.hash)}
              title="View diff"
            >
              <span className={styles.commitHash}>{c.hash.slice(0, 7)}</span>
              <span className={styles.commitMsg}>{c.message}</span>
              <span className={styles.commitTime}>{relativeTime(c.timestamp)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parent folder of a vault path, with trailing slash ("notes/a/b.md" → "notes/a/"). */
function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i + 1);
}

/** Fire a registered shortcut as if typed, so Shell's global handler runs it.
 *  Lets this panel trigger app actions it has no prop for without a Shell change. */
function replayShortcut(id: ShortcutId) {
  const parts = SHORTCUTS[id].keys.toLowerCase().split("+");
  const key = parts.pop() ?? "";
  const mod = parts.includes("mod");
  window.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: mod && !isMac,
    metaKey: mod && isMac,
    shiftKey: parts.includes("shift"),
    altKey: parts.includes("alt"),
  }));
}
