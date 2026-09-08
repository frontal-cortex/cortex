import { useState, useEffect, useRef, KeyboardEvent, useCallback } from "react";
import { NoteEntry, commands } from "../../lib/commands";
import { shortcutFor } from "../../lib/keymap";
import { SearchIcon, TemplateIcon, TodayIcon, GraphIcon, PlusIcon, SyncIcon, GearIcon, ThemeIcon, BrainIcon, PanelLeftIcon, TerminalIcon, MonkIcon, TagsListIcon, GlobeIcon, SparkleIcon } from "./icons";
import styles from "./QuickSwitcher.module.css";

interface Action {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  run: () => void;
}

interface Props {
  notes: NoteEntry[];
  /** Seed the input — ">" opens straight into command mode. */
  initialQuery?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  // Actions wired from Shell
  onNewNote: () => void;
  onToday: () => void;
  onOpenGraph: () => void;
  onNewFromTemplate: (tplName: string) => void;
  onNewCollection: () => void;
  onSync: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenMarketplace: () => void;
  onQuickCapture: () => void;
  onToggleSidebar: () => void;
  onToggleTerminal: () => void;
  onToggleMonk: () => void;
  onFocusSidebar: () => void;
  onToggleProperties: () => void;
  onPublish: () => void;
  /** Absent when no note is open. */
  onTogglePublic?: () => void;
  isPublic: boolean;
  hasRemote: boolean;
}

type Mode = "notes" | "actions";

export function QuickSwitcher({
  notes, initialQuery = "", onSelect, onClose,
  onNewNote, onToday, onOpenGraph, onNewFromTemplate,
  onNewCollection, onSync, onToggleTheme, onOpenSettings, onOpenMarketplace, onQuickCapture,
  onToggleSidebar, onToggleTerminal, onToggleMonk, onFocusSidebar, onToggleProperties,
  onPublish, onTogglePublic, isPublic, hasRemote,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const [templates, setTemplates] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    commands.listTemplates().then(setTemplates).catch(() => {});
  }, []);

  const isActionMode: Mode = query.startsWith(">") ? "actions" : "notes";
  const rawQuery = isActionMode === "actions" ? query.slice(1).trimStart() : query;

  // ── Note results ────────────────────────────────────────────────────────────
  const noteResults = isActionMode === "notes"
    ? (rawQuery
        ? notes.filter((n) =>
            n.title.toLowerCase().includes(rawQuery.toLowerCase()) ||
            n.path.toLowerCase().includes(rawQuery.toLowerCase()) ||
            n.tags.some((t) => t.toLowerCase().includes(rawQuery.toLowerCase())),
          )
        : notes.slice(0, 12))
    : [];

  // ── Action results ──────────────────────────────────────────────────────────
  const buildActions = useCallback((): Action[] => {
    const base: Action[] = [
      {
        id: "new-note",
        label: "New note",
        description: shortcutFor("new-note"),
        icon: <PlusIcon size={14} />,
        run: () => { onNewNote(); onClose(); },
      },
      {
        id: "today",
        label: "Today's note",
        description: `${shortcutFor("today")} · open or create today's journal entry`,
        icon: <TodayIcon size={14} />,
        run: () => { onToday(); onClose(); },
      },
      {
        id: "capture",
        label: "Quick capture",
        description: `${shortcutFor("quick-capture")} · append a line to today's note`,
        icon: <PlusIcon size={14} />,
        run: () => { onQuickCapture(); onClose(); },
      },
      {
        id: "graph",
        label: "Graph view",
        description: shortcutFor("graph"),
        icon: <GraphIcon size={14} />,
        run: () => { onOpenGraph(); onClose(); },
      },
      {
        id: "new-database",
        label: "New database",
        description: "Tabbed table / board / calendar over notes",
        icon: <BrainIcon size={14} />,
        run: () => { onNewCollection(); onClose(); },
      },
      {
        id: "marketplace",
        label: "Browse templates…",
        description: `${shortcutFor("marketplace")} · note templates and databases from the marketplace, installed as plain files`,
        icon: <SparkleIcon size={14} />,
        run: () => { onOpenMarketplace(); onClose(); },
      },
      ...(hasRemote ? [{
        id: "sync",
        label: "Sync vault",
        description: "Pull, merge, and push to the remote",
        icon: <SyncIcon size={14} />,
        run: () => { onSync(); onClose(); },
      }] : []),
      {
        id: "toggle-sidebar",
        label: "Toggle sidebar",
        description: shortcutFor("toggle-sidebar"),
        icon: <PanelLeftIcon size={14} />,
        run: () => { onToggleSidebar(); onClose(); },
      },
      {
        id: "focus-sidebar",
        label: "Focus sidebar",
        description: `${shortcutFor("focus-sidebar")} · then arrows / j k, Enter to open, n for a new note`,
        icon: <PanelLeftIcon size={14} />,
        run: () => { onFocusSidebar(); onClose(); },
      },
      {
        id: "publish",
        label: "Publish site…",
        description: "Build a static site from the notes marked public — nothing is published until you confirm",
        icon: <GlobeIcon size={14} />,
        run: () => { onPublish(); onClose(); },
      },
      ...(onTogglePublic ? [{
        id: "toggle-public",
        label: isPublic ? "Make this note private" : "Make this note public",
        description: isPublic
          ? "Remove publish: true — the note leaves the site on the next publish"
          : "Set publish: true — the note joins the site on the next publish; nothing is published now",
        icon: <GlobeIcon size={14} />,
        run: () => { onTogglePublic(); onClose(); },
      }] : []),
      {
        id: "toggle-properties",
        label: "Toggle properties",
        description: `${shortcutFor("toggle-properties")} · show or hide the note's property panel`,
        icon: <TagsListIcon size={14} />,
        run: () => { onToggleProperties(); onClose(); },
      },
      {
        id: "toggle-terminal",
        label: "Toggle terminal",
        description: shortcutFor("toggle-terminal"),
        icon: <TerminalIcon size={14} />,
        run: () => { onToggleTerminal(); onClose(); },
      },
      {
        id: "monk-mode",
        label: "Monk mode",
        description: `${shortcutFor("monk-mode")} · just the page, nothing else`,
        icon: <MonkIcon size={14} />,
        run: () => { onToggleMonk(); onClose(); },
      },
      {
        id: "toggle-theme",
        label: "Toggle light / dark theme",
        icon: <ThemeIcon size={14} />,
        run: () => { onToggleTheme(); onClose(); },
      },
      {
        id: "settings",
        label: "Settings",
        description: shortcutFor("settings"),
        icon: <GearIcon size={14} />,
        run: () => { onOpenSettings(); onClose(); },
      },
    ];
    const tplActions: Action[] = templates.map((t) => ({
      id: `tpl:${t}`,
      label: `New from template: ${t.replace(/\.md$/, "")}`,
      icon: <TemplateIcon size={14} />,
      run: () => { onNewFromTemplate(t); onClose(); },
    }));
    const more: Action[] = [{
      id: "tpl:more",
      label: "Get more templates…",
      description: "Open the marketplace",
      icon: <SparkleIcon size={14} />,
      run: () => { onOpenMarketplace(); onClose(); },
    }];
    return [...base, ...tplActions, ...more];
  }, [templates, hasRemote, onNewNote, onToday, onOpenGraph, onNewFromTemplate,
      onNewCollection, onSync, onToggleTheme, onOpenSettings, onOpenMarketplace, onQuickCapture,
      onToggleSidebar, onToggleTerminal, onToggleMonk, onFocusSidebar, onToggleProperties,
      onPublish, onTogglePublic, isPublic, onClose]);

  const actionResults = isActionMode === "actions"
    ? buildActions().filter((a) =>
        !rawQuery || a.label.toLowerCase().includes(rawQuery.toLowerCase()),
      )
    : [];

  const items = isActionMode === "notes"
    ? noteResults.map((n, i) => ({ id: n.path, type: "note" as const, note: n, index: i }))
    : actionResults.map((a, i) => ({ id: a.id, type: "action" as const, action: a, index: i }));

  const clamped = Math.min(activeIndex, Math.max(0, items.length - 1));
  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${clamped}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [clamped]);

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, items.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter") {
      e.preventDefault();
      const active = items[clamped];
      if (!active) return;
      if (active.type === "note") { onSelect(active.note.path); onClose(); }
      else active.action.run();
    }
  }

  const placeholder = isActionMode === "actions"
    ? "Run a command…"
    : "Jump to note… (type > for commands)";

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputRow}>
          {isActionMode === "actions"
            ? <span className={styles.cmdPrefix}>&gt;</span>
            : <SearchIcon size={14} />}
          <input
            ref={inputRef}
            className={styles.input}
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className={styles.esc}>Esc</kbd>
        </div>

        {items.length > 0 && (
          <div ref={listRef} className={styles.list}>
            {isActionMode === "notes"
              ? noteResults.map((note, i) => (
                  <button
                    key={note.path}
                    data-idx={i}
                    className={`${styles.item} ${i === clamped ? styles.itemActive : ""}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => { onSelect(note.path); onClose(); }}
                  >
                    <span className={styles.itemIcon}>{note.icon ?? "📄"}</span>
                    <span className={styles.itemTitle}>{note.title || "Untitled"}</span>
                    <span className={styles.itemPath}>{note.path}</span>
                  </button>
                ))
              : actionResults.map((action, i) => (
                  <button
                    key={action.id}
                    data-idx={i}
                    className={`${styles.item} ${i === clamped ? styles.itemActive : ""}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={action.run}
                  >
                    <span className={styles.itemIcon}>{action.icon}</span>
                    <span className={styles.itemTitle}>{action.label}</span>
                    {action.description && (
                      <span className={styles.itemPath}>{action.description}</span>
                    )}
                  </button>
                ))}
          </div>
        )}

        {query && items.length === 0 && (
          <p className={styles.empty}>
            {isActionMode === "actions"
              ? `No commands match "${rawQuery}"`
              : `No notes match "${rawQuery}"`}
          </p>
        )}

        {!query && (
          <p className={styles.hint}>Type <kbd className={styles.hintKbd}>&gt;</kbd> or press <kbd className={styles.hintKbd}>{shortcutFor("command-palette")}</kbd> to run commands</p>
        )}
      </div>
    </div>
  );
}
