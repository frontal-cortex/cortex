import { useEffect, useState } from "react";
import { commands, CommitEntry, Note } from "../../lib/commands";
import { lineDiff } from "../../lib/lineDiff";
import { CloseIcon } from "./icons";
import styles from "./NoteHistoryModal.module.css";

interface Props {
  path: string;
  /** Current working-tree note, used as the "diff against" baseline. */
  current: Note;
  onClose: () => void;
  onRestored: (note: Note) => void;
}

const HISTORY_LIMIT = 100;

export function NoteHistoryModal({ path, current, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<CommitEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [versionBody, setVersionBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    commands.noteHistory(path, HISTORY_LIMIT)
      .then((v) => {
        setVersions(v);
        if (v.length > 0) setSelected(v[0].hash);
      })
      .catch((e) => setError(String(e)));
  }, [path]);

  useEffect(() => {
    if (!selected) return;
    setVersionBody(null);
    commands.noteAt(path, selected)
      .then(setVersionBody)
      .catch((e) => setError(String(e)));
  }, [path, selected]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const handleRestore = async () => {
    if (!selected) return;
    setRestoring(true);
    try {
      const restored = await commands.restoreNote(path, selected);
      onRestored(restored);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setRestoring(false);
    }
  };

  // Reconstruct the full markdown of the current note to diff against the
  // historical file content (frontmatter + body).
  const currentFull = serializeNoteApprox(current);
  const diff = versionBody != null ? lineDiff(versionBody, currentFull) : null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Version history</span>
          <span className={styles.subtitle}>{path}</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <aside className={styles.rail}>
            {error && <p className={styles.error}>{error}</p>}
            {!versions && !error && <p className={styles.muted}>Loading…</p>}
            {versions && versions.length === 0 && (
              <p className={styles.muted}>
                No committed history yet. Versions appear here after you commit changes.
              </p>
            )}
            {versions?.map((v, i) => (
              <button
                key={v.hash}
                className={`${styles.versionRow} ${v.hash === selected ? styles.versionRowActive : ""}`}
                onClick={() => setSelected(v.hash)}
              >
                <span className={styles.versionMsg}>
                  {i === 0 ? "Latest · " : ""}{v.message || "(no message)"}
                </span>
                <span className={styles.versionMeta}>
                  {v.author} · {relTime(v.timestamp)}
                </span>
              </button>
            ))}
          </aside>

          <section className={styles.detail}>
            {selected && (
              <div className={styles.detailBar}>
                <span className={styles.diffLegend}>
                  Changes from this version → current
                </span>
                <button
                  className={styles.restoreBtn}
                  onClick={handleRestore}
                  disabled={restoring}
                >
                  {restoring ? "Restoring…" : "Restore this version"}
                </button>
              </div>
            )}
            <div className={styles.diffScroll}>
              {versionBody == null && selected && <p className={styles.muted}>Loading…</p>}
              {diff && diff.length === 0 && <p className={styles.muted}>Empty file.</p>}
              {diff && (
                <pre className={styles.diff}>
                  {diff.map((l, i) => (
                    <span
                      key={i}
                      className={
                        l.type === "add" ? styles.added :
                        l.type === "del" ? styles.removed :
                        styles.context
                      }
                    >
                      {l.type === "add" ? "+ " : l.type === "del" ? "- " : "  "}
                      {l.text}{"\n"}
                    </span>
                  ))}
                </pre>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Approximate the on-disk markdown for diffing — mirrors the Rust serializer:
 *  sorted YAML frontmatter, blank line, body. Good enough for a visual diff. */
function serializeNoteApprox(note: Note): string {
  const keys = Object.keys(note.frontmatter).sort();
  let out = "";
  if (keys.length > 0) {
    out += "---\n";
    for (const k of keys) {
      out += `${k}: ${yamlScalar(note.frontmatter[k])}\n`;
    }
    out += "---\n\n";
  }
  out += note.body;
  return out;
}

function yamlScalar(v: unknown): string {
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  if (v == null) return "";
  return String(v);
}

function relTime(s: number) {
  const d = Math.floor(Date.now() / 1000) - s;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(s * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
