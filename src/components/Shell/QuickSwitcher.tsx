import { useState, useEffect, useRef, KeyboardEvent, useCallback } from "react";
import { NoteEntry, commands } from "../../lib/commands";
import { SearchIcon, TemplateIcon, TodayIcon, GraphIcon, PlusIcon, SyncIcon, GearIcon, ThemeIcon, BrainIcon } from "./icons";
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
  onQuickCapture: () => void;
  hasRemote: boolean;
}

type Mode = "notes" | "actions";

export function QuickSwitcher({
  notes, onSelect, onClose,
  onNewNote, onToday, onOpenGraph, onNewFromTemplate,
  onNewCollection, onSync, onToggleTheme, onOpenSettings, onQuickCapture, hasRemote,
}: Props) {
  const [query, setQuery] = useState("");
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
        description: "⌘N",
        icon: <PlusIcon size={14} />,
        run: () => { onNewNote(); onClose(); },
      },
      {
        id: "today",
        label: "Today's note",
        description: "Open or create today's journal entry",
        icon: <TodayIcon size={14} />,
        run: () => { onToday(); onClose(); },
      },
      {
        id: "capture",
        label: "Quick capture",
        description: "⌘⇧K · append a line to today's note",
        icon: <PlusIcon size={14} />,
        run: () => { onQuickCapture(); onClose(); },
      },
      {
        id: "graph",
        label: "Graph view",
        description: "⌘G",
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
      ...(hasRemote ? [{
        id: "sync",
        label: "Sync vault",
        description: "Pull, rebase, and push to the remote",
        icon: <SyncIcon size={14} />,
        run: () => { onSync(); onClose(); },
      }] : []),
      {
        id: "toggle-theme",
        label: "Toggle light / dark theme",
        icon: <ThemeIcon size={14} />,
        run: () => { onToggleTheme(); onClose(); },
      },
      {
        id: "settings",
        label: "Settings",
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
    return [...base, ...tplActions];
  }, [templates, hasRemote, onNewNote, onToday, onOpenGraph, onNewFromTemplate,
      onNewCollection, onSync, onToggleTheme, onOpenSettings, onQuickCapture, onClose]);

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
          <p className={styles.hint}>Type <kbd className={styles.hintKbd}>&gt;</kbd> to run commands</p>
        )}
      </div>
    </div>
  );
}
