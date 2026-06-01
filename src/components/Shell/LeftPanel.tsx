import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { NoteEntry, VaultStatus, AgentBranch, CommitEntry, TrashEntry } from "../../lib/commands";
import { commands } from "../../lib/commands";
import { buildTree } from "../../lib/fileTree";
import { FileTree } from "./FileTree";
import { CommitDiffModal } from "./CommitDiffModal";
import { CloseIcon, MinusIcon, StarFilledIcon, TemplateIcon } from "./icons";
import styles from "./LeftPanel.module.css";

interface Props {
  notes: NoteEntry[];
  dirs: string[];
  selectedPath: string | null;
  status: VaultStatus | null;
  agentBranches: AgentBranch[];
  commits: CommitEntry[];
  favorites: string[];
  onSelect: (path: string) => void;
  onNewNote: (parentFolder?: string) => void;
  onToggleFavorite: (path: string) => void;
  isFavorite: (path: string) => boolean;
  onOpenGraph: () => void;
  onNewFromTemplate: (templateName: string) => void;
  onNewCollection: () => void;
  onOpenCollection: (name: string) => void;
  onCommit: (message: string) => Promise<void>;
  onApplyBranch: (name: string) => void;
  onDiscardBranch: (name: string) => void;
  onRefresh: () => void;
  trash: TrashEntry[];
  onRestoreTrashed: (id: string) => void;
  onDeleteTrashed: (id: string) => void;
  onEmptyTrash: () => void;
}

export function LeftPanel({
  notes, dirs, selectedPath, status, agentBranches, commits, favorites,
  onSelect, onNewNote, onToggleFavorite, isFavorite, onOpenGraph,
  onNewFromTemplate, onNewCollection, onOpenCollection,
  onCommit, onApplyBranch, onDiscardBranch, onRefresh,
  trash, onRestoreTrashed, onDeleteTrashed, onEmptyTrash,
}: Props) {
  // Unused until command palette wires the template picker — accepted here so
  // Shell can pass it down without TS errors.
  void onNewFromTemplate;
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NoteEntry[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [newFolderIn, setNewFolderIn] = useState<string | null>(null);
  const [diffHash, setDiffHash] = useState<string | null>(null);
  // Notes section root drop zone
  const [notesSectionDragOver, setNotesSectionDragOver] = useState(false);

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
        ));
      }
    }, 200);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, notes]);

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

  const handleCreateFolder = useCallback(async (parentPath: string, name: string) => {
    const cleaned = name.trim().replace(/\/+/g, "");
    if (!cleaned) return;
    const fullPath = `${parentPath.replace(/\/$/, "")}/${cleaned}`;
    await commands.createFolder(fullPath);
    setNewFolderIn(null);
    onRefresh();
  }, [onRefresh]);

  const notesTree    = useMemo(() => buildTree(notes, "notes/", dirs),     [notes, dirs]);
  const templateTree = useMemo(() => buildTree(notes, "templates/"),       [notes]);

  // Collection folders under collections/, derived from note paths.
  const collections = useMemo(() => {
    const names = new Set<string>();
    for (const n of notes) {
      const m = n.path.match(/^collections\/([^/]+)\//);
      if (m) names.add(m[1]);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [notes]);

  const treeActions = useMemo(() => ({
    newFolderIn,
    onNewFolderRequest: setNewFolderIn,
    onNewFolderSubmit: handleCreateFolder,
    onNewFolderCancel: () => setNewFolderIn(null),
    onNewNoteInFolder: (parentPath: string) => onNewNote(parentPath),
    onDeleteFolder: handleDeleteFolder,
    onMoveNote: handleMoveNote,
    onToggleFavorite,
    isFavorite,
  }), [newFolderIn, handleCreateFolder, onNewNote, handleDeleteFolder, handleMoveNote, onToggleFavorite, isFavorite]);

  const notesCount = notes.filter((n) => n.path.startsWith("notes/")).length;

  return (
    <div className={styles.root}>
      {/* ── Search ──────────────────────────────────────────────── */}
      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <SearchIcon />
          <input
            className={styles.searchInput}
            placeholder="Search… (⌘K to jump)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && <button className={styles.clearBtn} onClick={() => setQuery("")} title="Clear search"><CloseIcon size={13} /></button>}
        </div>
      </div>

      {/* ── Tree / Search results ────────────────────────────────── */}
      <div className={styles.treeArea}>
        {searchResults ? (
          <div className={styles.searchResults}>
            {searchResults.length === 0 && <p className={styles.empty}>No matches for "{query}"</p>}
            {searchResults.map((n) => (
              <button
                key={n.path}
                className={`${styles.resultRow} ${n.path === selectedPath ? styles.resultRowSelected : ""}`}
                onClick={() => onSelect(n.path)}
              >
                <span className={styles.resultTitle}>{n.title || "Untitled"}</span>
                <span className={styles.resultPath}>{n.path}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            {favorites.length > 0 && (
              <Section label="Favorites" defaultOpen count={favorites.length}>
                {favorites.map((path) => {
                  const note = notes.find((n) => n.path === path);
                  if (!note) return null;
                  return (
                    <button
                      key={path}
                      className={`${styles.favRow} ${path === selectedPath ? styles.favRowSelected : ""}`}
                      onClick={() => onSelect(path)}
                    >
                      {note.icon
                        ? <span className={styles.favIcon}>{note.icon}</span>
                        : <DocIcon />}
                      <span className={styles.favTitle}>{note.title || "Untitled"}</span>
                      <button
                        className={styles.favStar}
                        onClick={(e) => { e.stopPropagation(); onToggleFavorite(path); }}
                        title="Remove from favorites"
                      ><StarFilledIcon size={12} /></button>
                    </button>
                  );
                })}
              </Section>
            )}

            <Section
              label="Notes"
              defaultOpen
              count={notesCount}
              onNewNote={() => onNewNote()}
              onNewFolder={() => setNewFolderIn("notes/")}
              onAction={onOpenGraph}
              actionTitle="Graph view"
              actionIcon={<GraphIcon />}
              dropActive={notesSectionDragOver}
              onDragOver={(e) => { e.preventDefault(); setNotesSectionDragOver(true); }}
              onDragLeave={() => setNotesSectionDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setNotesSectionDragOver(false);
                const path = e.dataTransfer.getData("text/plain");
                if (path) handleMoveNote(path, "notes/");
              }}
            >
              {notesTree.length === 0 && newFolderIn !== "notes/"
                ? <p className={styles.empty}>No notes yet — press ⌘N to create one.</p>
                : <FileTree
                    nodes={notesTree}
                    currentPath="notes/"
                    selectedPath={selectedPath}
                    defaultOpen
                    actions={treeActions}
                    onSelect={onSelect}
                  />}
            </Section>

            <Section
              label="Collections"
              defaultOpen
              count={collections.length}
              onNewNote={onNewCollection}
              actionTitle="New collection"
            >
              {collections.length === 0
                ? <p className={styles.empty}>
                    No collections yet.{" "}
                    <button className={styles.emptyAction} onClick={onNewCollection}>
                      Create one
                    </button>{" "}
                    — a structured table of notes.
                  </p>
                : collections.map((name) => {
                    const indexPath = `collections/${name}/_index.md`;
                    return (
                      <button
                        key={name}
                        className={`${styles.favRow} ${indexPath === selectedPath ? styles.favRowSelected : ""}`}
                        onClick={() => onOpenCollection(name)}
                      >
                        <TemplateIcon size={14} />
                        <span className={styles.favTitle}>{name}</span>
                      </button>
                    );
                  })}
            </Section>

            <Section
              label="Templates"
              defaultOpen={false}
              count={templateTree.length}
              onNewFolder={undefined}
              onNewNote={() => onNewNote("templates")}
            >
              {templateTree.length === 0
                ? <p className={styles.empty}>
                    No templates yet.{" "}
                    <button className={styles.emptyAction} onClick={() => onNewNote("templates")}>
                      Create one
                    </button>{" "}
                    to use as a starting point for new notes.
                  </p>
                : <FileTree
                    nodes={templateTree}
                    currentPath="templates/"
                    selectedPath={selectedPath}
                    defaultOpen
                    actions={{ ...treeActions, onNewFolderRequest: () => {}, newFolderIn: null, onNewNoteInFolder: (p) => onNewNote(p) }}
                    onSelect={onSelect}
                  />}
            </Section>

            {trash.length > 0 && (
              <Section label="Trash" defaultOpen={false} count={trash.length}>
                {trash.map((t) => (
                  <div key={t.id} className={styles.trashRow}>
                    <span className={styles.trashTitle} title={t.original_path}>
                      {t.title || "Untitled"}
                    </span>
                    <button
                      className={styles.trashAction}
                      onClick={() => onRestoreTrashed(t.id)}
                      title="Restore to original location"
                    >
                      Restore
                    </button>
                    <button
                      className={styles.trashDelete}
                      onClick={() => onDeleteTrashed(t.id)}
                      title="Delete permanently"
                    >
                      <CloseIcon size={12} />
                    </button>
                  </div>
                ))}
                <button className={styles.emptyTrashBtn} onClick={onEmptyTrash}>
                  Empty trash
                </button>
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
        onApplyBranch={onApplyBranch}
        onDiscardBranch={onDiscardBranch}
        onCommitClick={setDiffHash}
      />

      {diffHash && (
        <CommitDiffModal hash={diffHash} onClose={() => setDiffHash(null)} />
      )}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({
  label, count, defaultOpen, onNewFolder, onNewNote, onAction, actionIcon, actionTitle,
  dropActive, onDragOver, onDragLeave, onDrop, children,
}: {
  label: string;
  count: number;
  defaultOpen: boolean;
  onNewFolder?: () => void;
  onNewNote?: () => void;
  onAction?: () => void;
  actionIcon?: React.ReactNode;
  actionTitle?: string;
  dropActive?: boolean;
  onDragOver?: React.DragEventHandler;
  onDragLeave?: React.DragEventHandler;
  onDrop?: React.DragEventHandler;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={`${styles.section} ${dropActive ? styles.sectionDropTarget : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={styles.sectionHeader}>
        <button className={styles.sectionToggle} onClick={() => setOpen((x) => !x)}>
          <span className={`${styles.sectionArrow} ${open ? styles.sectionArrowOpen : ""}`}>▶</span>
          <span className={styles.sectionLabel}>{label}</span>
        </button>
        <div className={styles.sectionActions}>
          {onNewNote && (
            <button
              className={styles.sectionAction}
              onClick={(e) => { e.stopPropagation(); setOpen(true); onNewNote(); }}
              title={`New ${label.toLowerCase().replace(/s$/, "")}`}
            >
              <PlusIcon />
            </button>
          )}
          {onNewFolder && (
            <button
              className={styles.sectionAction}
              onClick={(e) => { e.stopPropagation(); setOpen(true); onNewFolder(); }}
              title="New folder"
            >
              <FolderPlusIcon />
            </button>
          )}
          {onAction && (
            <button
              className={styles.sectionAction}
              onClick={(e) => { e.stopPropagation(); onAction(); }}
              title={actionTitle}
            >
              {actionIcon}
            </button>
          )}
        </div>
        <span className={styles.sectionCount}>{count}</span>
      </div>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </div>
  );
}

// ── Git section ───────────────────────────────────────────────────────────────

function GitSection({
  status, isDirty, changedCount, commits, agentBranches,
  onCommit, onApplyBranch, onDiscardBranch, onCommitClick,
}: {
  status: VaultStatus | null;
  isDirty: boolean;
  changedCount: number;
  commits: CommitEntry[];
  agentBranches: AgentBranch[];
  onCommit: (msg: string) => Promise<void>;
  onApplyBranch: (name: string) => void;
  onDiscardBranch: (name: string) => void;
  onCommitClick: (hash: string) => void;
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
        <div key={b.name} className={styles.agentBranch}>
          <span className={styles.agentDot}>●</span>
          <span className={styles.agentDesc}>{b.description}</span>
          <button className={styles.applyBtn} onClick={() => onApplyBranch(b.name)}>Apply</button>
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
              <span className={styles.commitTime}>{relTime(c.timestamp)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers & icons ───────────────────────────────────────────────────────────

function relTime(s: number) {
  const d = Math.floor(Date.now() / 1000) - s;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
}
function SearchIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}
function GraphIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><line x1="7" y1="11.5" x2="17" y2="6.5"/><line x1="7" y1="12.5" x2="17" y2="17.5"/></svg>;
}

function DocIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>;
}

function FolderPlusIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>;
}
