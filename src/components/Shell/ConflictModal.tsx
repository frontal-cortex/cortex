// Sync-conflict resolution — the UI for the merge-marker strategy documented in
// ARCHITECTURE.md. The repo is mid-merge: each listed file contains standard
// `<<<<<<<` conflict markers. Per file the user can keep their version, take the
// teammate's, or open the note and edit the markers by hand (then mark it
// resolved). When nothing is left, "Complete sync" commits the merge and pushes.
// "Cancel sync" aborts the merge — local commits stay, remote changes un-apply.

import { useState } from "react";
import { commands } from "../../lib/commands";
import styles from "./ConflictModal.module.css";

interface Props {
  files: string[];
  /** Open a conflicted note in the editor for manual fixing (closes the modal). */
  onOpenFile: (path: string) => void;
  /** Merge committed + pushed. */
  onCompleted: () => void;
  /** Merge aborted. */
  onAborted: () => void;
  /** Hide the modal, leaving the merge pending (sync will re-surface it). */
  onClose: () => void;
}

export function ConflictModal({ files: initial, onOpenFile, onCompleted, onAborted, onClose }: Props) {
  const [files, setFiles] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => commands.gitConflicts().then(setFiles).catch(() => {});

  const resolve = async (file: string, side: "ours" | "theirs" | "manual") => {
    setBusy(file);
    setError(null);
    try {
      await commands.gitResolveConflict(file, side);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const complete = async () => {
    setBusy("__complete");
    setError(null);
    try {
      const outcome = await commands.gitCompleteMerge();
      if (outcome.status === "conflicts") {
        setFiles(outcome.files);
      } else {
        onCompleted();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const abort = async () => {
    if (!window.confirm("Cancel this sync? Your local changes stay; your teammate's changes will be re-applied on the next sync.")) return;
    setBusy("__abort");
    setError(null);
    try {
      await commands.gitAbortMerge();
      onAborted();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Sync conflicts</span>
          <span className={styles.subtitle}>
            A teammate changed the same notes. Pick a version per file, or open it to merge by hand.
          </span>
        </div>

        <div className={styles.list}>
          {files.length === 0 && (
            <div className={styles.allResolved}>All conflicts resolved — complete the sync below.</div>
          )}
          {files.map((file) => (
            <div key={file} className={styles.row}>
              <button
                className={styles.fileBtn}
                title="Open this note to merge by hand"
                onClick={() => { onOpenFile(file); onClose(); }}
              >
                {file}
              </button>
              <div className={styles.rowActions}>
                <button className={styles.actBtn} disabled={busy === file} onClick={() => resolve(file, "ours")}>
                  Keep mine
                </button>
                <button className={styles.actBtn} disabled={busy === file} onClick={() => resolve(file, "theirs")}>
                  Take theirs
                </button>
                <button
                  className={styles.actBtnQuiet}
                  disabled={busy === file}
                  title="I already fixed the markers in this file"
                  onClick={() => resolve(file, "manual")}
                >
                  Mark resolved
                </button>
              </div>
            </div>
          ))}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.footer}>
          <button className={styles.abortBtn} disabled={busy !== null} onClick={abort}>
            Cancel sync
          </button>
          <div className={styles.footerRight}>
            <button className={styles.laterBtn} onClick={onClose}>Later</button>
            <button
              className={styles.completeBtn}
              disabled={files.length > 0 || busy !== null}
              onClick={complete}
            >
              Complete sync
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
