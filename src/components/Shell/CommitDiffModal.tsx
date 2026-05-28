import { useEffect, useState } from "react";
import { commands, CommitDiff } from "../../lib/commands";
import styles from "./CommitDiffModal.module.css";

interface Props {
  hash: string;
  onClose: () => void;
}

export function CommitDiffModal({ hash, onClose }: Props) {
  const [diff, setDiff] = useState<CommitDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    commands.gitDiff(hash)
      .then(setDiff)
      .catch((e) => setError(String(e)));
  }, [hash]);

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
            <code className={styles.hash}>{hash}</code>
            {diff && (
              <>
                <span className={styles.message}>{diff.message}</span>
                <span className={styles.author}>{diff.author} · {relTime(diff.timestamp)}</span>
              </>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          {!diff && !error && <p className={styles.loading}>Loading…</p>}
          {error && <p className={styles.errorMsg}>{error}</p>}
          {diff && (
            diff.patch
              ? <DiffView patch={diff.patch} />
              : <p className={styles.empty}>No changes in this commit.</p>
          )}
        </div>
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
