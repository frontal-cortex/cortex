import { useState } from "react";
import { VaultInfo, VaultStatus, AgentBranch, CommitEntry } from "../../lib/commands";
import styles from "./Sidebar.module.css";

interface Props {
  vault: VaultInfo;
  status: VaultStatus | null;
  agentBranches: AgentBranch[];
  commits: CommitEntry[];
  syncing: boolean;
  activeView: string;
  onViewChange: (view: string) => void;
  onSync: () => void;
  onCommit: (message: string) => Promise<void>;
  onApplyBranch: (name: string) => void;
  onDiscardBranch: (name: string) => void;
}

export function Sidebar({
  vault,
  status,
  agentBranches,
  commits,
  syncing,
  activeView,
  onViewChange,
  onSync,
  onCommit,
  onApplyBranch,
  onDiscardBranch,
}: Props) {
  const changedCount =
    (status?.staged.length ?? 0) +
    (status?.unstaged.length ?? 0) +
    (status?.untracked.length ?? 0);
  const isDirty = changedCount > 0;

  return (
    <nav className={styles.root}>
      <div className={styles.header}>
        <span className={styles.vaultName}>{vault.name}</span>
        <button
          className={styles.syncButton}
          onClick={onSync}
          disabled={syncing || !vault.has_remote}
          title={vault.has_remote ? "Sync with remote" : "No remote configured"}
        >
          <SyncIcon spinning={syncing} />
        </button>
      </div>

      <div className={styles.section}>
        <NavItem
          icon={<HomeIcon />}
          label="All notes"
          active={activeView === "all"}
          onClick={() => onViewChange("all")}
        />
        <NavItem
          icon={<ClockIcon />}
          label="Recent"
          active={activeView === "recent"}
          onClick={() => onViewChange("recent")}
        />
      </div>

      <GitSection
        status={status}
        isDirty={isDirty}
        changedCount={changedCount}
        commits={commits}
        onCommit={onCommit}
      />

      {agentBranches.length > 0 && (
        <div className={styles.section}>
          <p className={styles.sectionLabel}>Agent proposals</p>
          {agentBranches.map((b) => (
            <div key={b.name} className={styles.agentBranch}>
              <div className={styles.agentInfo}>
                <AgentIcon />
                <span className={styles.agentDesc}>{b.description}</span>
                <span className={styles.agentCount}>{b.commit_count}c</span>
              </div>
              <div className={styles.agentActions}>
                <button className={styles.applyBtn} onClick={() => onApplyBranch(b.name)}>
                  Apply
                </button>
                <button className={styles.discardBtn} onClick={() => onDiscardBranch(b.name)}>
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}

function GitSection({
  status,
  isDirty,
  changedCount,
  commits,
  onCommit,
}: {
  status: VaultStatus | null;
  isDirty: boolean;
  changedCount: number;
  commits: CommitEntry[];
  onCommit: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCommit = async () => {
    const msg = message.trim() || "Update notes";
    setCommitting(true);
    try {
      await onCommit(msg);
      setMessage("");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.gitHeader}>
        <p className={styles.sectionLabel} style={{ margin: 0 }}>Git</p>
        <div className={styles.gitStatus}>
          <span
            className={styles.statusDot}
            style={{ background: isDirty ? "var(--git-dirty)" : "var(--git-clean)" }}
          />
          <span className={styles.statusText}>
            {isDirty ? `${changedCount} changed` : "Clean"}
          </span>
          {(status?.ahead ?? 0) > 0 && (
            <span className={styles.pill}>{status!.ahead}↑</span>
          )}
          {(status?.behind ?? 0) > 0 && (
            <span className={styles.pill}>{status!.behind}↓</span>
          )}
        </div>
        {isDirty && (
          <button
            className={styles.expandToggle}
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? "−" : "Commit"}
          </button>
        )}
      </div>

      {isDirty && expanded && (
        <div className={styles.commitForm}>
          <input
            className={styles.commitInput}
            placeholder="Commit message…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCommit()}
            autoFocus
          />
          {status && (
            <div className={styles.changedFiles}>
              {[...status.staged, ...status.unstaged, ...status.untracked]
                .slice(0, 5)
                .map((f) => (
                  <span key={f} className={styles.changedFile}>
                    {f.split("/").pop()}
                  </span>
                ))}
              {changedCount > 5 && (
                <span className={styles.changedFile}>+{changedCount - 5} more</span>
              )}
            </div>
          )}
          <button
            className={styles.commitBtn}
            onClick={handleCommit}
            disabled={committing}
          >
            {committing ? "Committing…" : "Commit all"}
          </button>
        </div>
      )}

      {commits.length > 0 && (
        <div className={styles.commitLog}>
          {commits.map((c) => (
            <div key={c.hash} className={styles.commitRow}>
              <span className={styles.commitHash}>{c.hash}</span>
              <span className={styles.commitMsg}>{c.message}</span>
              <span className={styles.commitTime}>{relativeTime(c.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function relativeTime(unixSecs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSecs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
      onClick={onClick}
    >
      <span className={styles.navIcon}>{icon}</span>
      {label}
    </button>
  );
}

function HomeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ animation: spinning ? "spin 1s linear infinite" : undefined }}
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4l3 3" />
    </svg>
  );
}
