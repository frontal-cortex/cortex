import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { NoteEntry, VaultInfo, VaultStatus, AgentBranch, CommitEntry } from "../../lib/commands";
import { commands } from "../../lib/commands";
import { buildTree } from "../../lib/fileTree";
import { FileTree } from "./FileTree";
import styles from "./LeftPanel.module.css";

interface Props {
  vault: VaultInfo;
  notes: NoteEntry[];
  selectedPath: string | null;
  status: VaultStatus | null;
  agentBranches: AgentBranch[];
  commits: CommitEntry[];
  syncing: boolean;
  onSelect: (path: string) => void;
  onNewNote: (parentFolder?: string) => void;
  onTodayNote: () => void;
  onSync: () => void;
  onCommit: (message: string) => Promise<void>;
  onApplyBranch: (name: string) => void;
  onDiscardBranch: (name: string) => void;
  onRefresh: () => void;
}

export function LeftPanel({
  vault, notes, selectedPath, status, agentBranches, commits, syncing,
  onSelect, onNewNote, onTodayNote, onSync, onCommit, onApplyBranch, onDiscardBranch, onRefresh,
}: Props) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NoteEntry[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Folder creation state
  const [newFolderIn, setNewFolderIn] = useState<string | null>(null);

  const changedCount = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0);
  const isDirty = changedCount > 0;
  const needsSync = vault.has_remote && ((status?.ahead ?? 0) > 0 || (status?.behind ?? 0) > 0);

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

  // Folder creation handler
  const handleCreateFolder = useCallback(async (parentPath: string, name: string) => {
    const cleaned = name.trim().replace(/\/+/g, "");
    if (!cleaned) return;
    const fullPath = `${parentPath.replace(/\/$/, "")}/${cleaned}`;
    await commands.createFolder(fullPath);
    setNewFolderIn(null);
    onRefresh();
  }, [onRefresh]);

  const notesTree    = useMemo(() => buildTree(notes, "notes/"),     [notes]);
  const templateTree = useMemo(() => buildTree(notes, "templates/"), [notes]);

  const treeActions = useMemo(() => ({
    newFolderIn,
    onNewFolderRequest: setNewFolderIn,
    onNewFolderSubmit: handleCreateFolder,
    onNewFolderCancel: () => setNewFolderIn(null),
    onNewNoteInFolder: (parentPath: string) => onNewNote(parentPath),
  }), [newFolderIn, handleCreateFolder, onNewNote]);

  const notesCount = notes.filter((n) => n.path.startsWith("notes/")).length;

  return (
    <div className={styles.root}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className={styles.header}>
        <span className={styles.vaultName}>{vault.name}</span>
        <div className={styles.headerActions}>
          <button className={styles.iconBtn} onClick={onTodayNote} title="Open today's note">
            <CalendarIcon />
          </button>
          <button className={styles.iconBtn} onClick={() => onNewNote()} title="New note (⌘N)">
            <PlusIcon />
          </button>
          <button
            className={`${styles.iconBtn} ${needsSync ? styles.iconBtnAlert : ""}`}
            onClick={onSync}
            disabled={syncing || !vault.has_remote}
            title={!vault.has_remote ? "No remote configured" : needsSync ? `${status?.ahead ?? 0}↑ ${status?.behind ?? 0}↓` : "Up to date"}
          >
            {needsSync && !syncing && <span className={styles.syncDot} />}
            <SyncIcon spinning={syncing} />
          </button>
        </div>
      </div>

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
          {query && <button className={styles.clearBtn} onClick={() => setQuery("")}>×</button>}
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
            <Section
              label="Notes"
              defaultOpen
              count={notesCount}
              onNewFolder={() => setNewFolderIn("notes/")}
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

            {templateTree.length > 0 && (
              <Section label="Templates" defaultOpen={false} count={templateTree.length}>
                <FileTree
                  nodes={templateTree}
                  currentPath="templates/"
                  selectedPath={selectedPath}
                  defaultOpen
                  actions={{ ...treeActions, onNewFolderRequest: () => {}, newFolderIn: null }}
                  onSelect={onSelect}
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
        onApplyBranch={onApplyBranch}
        onDiscardBranch={onDiscardBranch}
      />
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({
  label, count, defaultOpen, onNewFolder, children,
}: {
  label: string;
  count: number;
  defaultOpen: boolean;
  onNewFolder?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <button className={styles.sectionToggle} onClick={() => setOpen((x) => !x)}>
          <span className={`${styles.sectionArrow} ${open ? styles.sectionArrowOpen : ""}`}>▶</span>
          <span className={styles.sectionLabel}>{label}</span>
          <span className={styles.sectionCount}>{count}</span>
        </button>
        {onNewFolder && (
          <button
            className={styles.sectionAction}
            onClick={(e) => { e.stopPropagation(); setOpen(true); onNewFolder(); }}
            title="New folder"
          >
            <FolderPlusIcon />
          </button>
        )}
      </div>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </div>
  );
}

// ── Git section ───────────────────────────────────────────────────────────────

function GitSection({
  status, isDirty, changedCount, commits, agentBranches, onCommit, onApplyBranch, onDiscardBranch,
}: {
  status: VaultStatus | null;
  isDirty: boolean;
  changedCount: number;
  commits: CommitEntry[];
  agentBranches: AgentBranch[];
  onCommit: (msg: string) => Promise<void>;
  onApplyBranch: (name: string) => void;
  onDiscardBranch: (name: string) => void;
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
            {expanded ? "−" : "Commit"}
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
          <button className={styles.discardBtn} onClick={() => onDiscardBranch(b.name)}>✕</button>
        </div>
      ))}

      {commits.length > 0 && (
        <div className={styles.commitLog}>
          {commits.map((c) => (
            <div key={c.hash} className={styles.commitRow}>
              <span className={styles.commitHash}>{c.hash}</span>
              <span className={styles.commitMsg}>{c.message}</span>
              <span className={styles.commitTime}>{relTime(c.timestamp)}</span>
            </div>
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
function CalendarIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
}
function SyncIcon({ spinning }: { spinning: boolean }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: spinning ? "spin 1s linear infinite" : undefined }}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
}
function SearchIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}
function FolderPlusIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>;
}
