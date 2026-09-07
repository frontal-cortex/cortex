import { useEffect, useState } from "react";
import { commands, CommitDiff, AgentBranch } from "../../lib/commands";
import { CloseIcon } from "./icons";
import styles from "./CommitDiffModal.module.css";

/** Shows one commit's diff — or, given a proposal, what applying it would
 *  change, with Apply / Discard right there so the diff is always seen first. */
type Props =
  | { hash: string; branch?: undefined; onClose: () => void; onApply?: undefined; onDiscard?: undefined }
  | { hash?: undefined; branch: AgentBranch; onClose: () => void; onApply: () => void; onDiscard: () => void };

export function CommitDiffModal({ hash, branch, onClose, onApply, onDiscard }: Props) {
  const [diff, setDiff] = useState<CommitDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = branch ? commands.agentBranchDiff(branch.name) : commands.gitDiff(hash!);
    load.then(setDiff).catch((e) => setError(String(e)));
  }, [hash, branch]);

  const act = async (fn: () => void) => {
    setBusy(true);
    try { await fn(); onClose(); } finally { setBusy(false); }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerMeta}>
            {branch
              ? <span className={styles.proposalTag}>Proposal{branch.remote ? " · on origin" : ""}</span>
              : <code className={styles.hash}>{hash}</code>}
            {diff && (
              <>
                <span className={styles.message}>{branch ? branch.description : diff.message}</span>
                <span className={styles.author}>
                  {diff.author} · {relTime(diff.timestamp)}
                  {branch && ` · ${branch.commit_count} commit${branch.commit_count === 1 ? "" : "s"}`}
                </span>
              </>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Close"><CloseIcon size={16} /></button>
        </div>

        <div className={styles.body}>
          {!diff && !error && <p className={styles.loading}>Loading…</p>}
          {error && <p className={styles.errorMsg}>{error}</p>}
          {diff && (
            diff.patch
              ? <DiffView patch={diff.patch} />
              : <p className={styles.empty}>{branch ? "This proposal changes nothing beyond the current branch." : "No changes in this commit."}</p>
          )}
        </div>

        {branch && (
          <div className={styles.footer}>
            <button className={styles.discardBtn} onClick={() => act(onDiscard)} disabled={busy}>Discard</button>
            <button className={styles.applyBtn} onClick={() => act(onApply)} disabled={busy || !diff}>
              {busy ? "Applying…" : "Apply to vault"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DiffView({ patch }: { patch: string }) {
  const lines = patch.split("\n");

  return (
    <pre className={styles.diff}>
      {lines.map((line, i) => {
        const cls =
          line.startsWith("+++ ") || line.startsWith("--- ") ? styles.lineFileHeader :
          line.startsWith("@@")   ? styles.lineHunk :
          line.startsWith("diff ") || line.startsWith("index ") ? styles.lineMeta :
          line.startsWith("+")    ? styles.lineAdded :
          line.startsWith("-")    ? styles.lineRemoved :
          styles.lineContext;

        return (
          <span key={i} className={cls}>
            {line}{"\n"}
          </span>
        );
      })}
    </pre>
  );
}

function relTime(s: number) {
  const d = Math.floor(Date.now() / 1000) - s;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(s * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
