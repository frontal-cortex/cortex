// ── Repository summary ───────────────────────────────────────────────────────
// What the sidebar used to carry in its bottom corner: what has changed, the
// way to commit it, and the last commits. It belongs here — a vault's history
// is something you look at when you go looking, not a permanent fixture beside
// the notes. Proposals from agents stayed in the sidebar; those are work
// waiting on a person.
//
// The numbers are read when Settings opens and after each commit, so nothing
// here is kept in sync with anything.

import { useCallback, useEffect, useState } from "react";
import { commands, CommitEntry, VaultStatus } from "../../lib/commands";
import { relativeTime } from "../../lib/fileTree";
import { CommitDiffModal } from "./CommitDiffModal";
import styles from "./GitSummary.module.css";

const LOG_LIMIT = 12;

export function GitSummary({ onCommit }: { onCommit: (message: string) => Promise<void> }) {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [msg, setMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [diffHash, setDiffHash] = useState<string | null>(null);

  const load = useCallback(() => {
    commands.gitStatus().then(setStatus).catch(() => setStatus(null));
    commands.gitLog(LOG_LIMIT).then(setCommits).catch(() => setCommits([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const changed = status ? [...status.staged, ...status.unstaged, ...status.untracked] : [];
  const dirty = changed.length > 0;

  const commit = async () => {
    setCommitting(true);
    try { await onCommit(msg.trim() || "Update notes"); setMsg(""); }
    finally { setCommitting(false); load(); }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.status}>
        <span className={styles.dot} style={{ background: dirty ? "var(--git-dirty)" : "var(--git-clean)" }} />
        <span className={styles.statusText}>
          {status === null ? "No repository" : dirty ? `${changed.length} file${changed.length === 1 ? "" : "s"} changed` : "Everything committed"}
        </span>
        {(status?.ahead ?? 0) > 0 && <span className={styles.pill} title="Commits to push">{status!.ahead}↑</span>}
        {(status?.behind ?? 0) > 0 && <span className={styles.pill} title="Commits to pull">{status!.behind}↓</span>}
        <button className={styles.refresh} onClick={load}>Refresh</button>
      </div>

      {dirty && (
        <div className={styles.commitBox}>
          <div className={styles.files}>
            {changed.slice(0, 8).map((f) => <span key={f} className={styles.file} title={f}>{f.split("/").pop()}</span>)}
            {changed.length > 8 && <span className={styles.file}>+{changed.length - 8} more</span>}
          </div>
          <div className={styles.commitRow}>
            <input
              className={styles.input}
              placeholder="Commit message…"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
            />
            <button className={styles.commitBtn} onClick={commit} disabled={committing}>
              {committing ? "Committing…" : "Commit all"}
            </button>
          </div>
        </div>
      )}

      {commits.length > 0 && (
        <div className={styles.log}>
          {commits.map((c) => (
            <button key={c.hash} className={styles.commit} onClick={() => setDiffHash(c.hash)} title="View the diff">
              <span className={styles.hash}>{c.hash.slice(0, 7)}</span>
              <span className={styles.message}>{c.message}</span>
              <span className={styles.time}>{relativeTime(c.timestamp)}</span>
            </button>
          ))}
        </div>
      )}

      {diffHash && <CommitDiffModal hash={diffHash} onClose={() => setDiffHash(null)} />}
    </div>
  );
}
