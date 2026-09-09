// ── Outline ──────────────────────────────────────────────────────────────────
// The note's headings, derived live from the editor's blocks. Click to jump;
// the entry under the cursor is marked so the pane doubles as a "where am I".

import { OutlineEntry } from "../../lib/textStats";
import { shortcutFor } from "../../lib/keymap";
import { CloseIcon } from "./icons";
import styles from "./OutlinePane.module.css";

interface Props {
  entries: OutlineEntry[];
  activeId: string | null;
  onJump: (id: string) => void;
  onClose: () => void;
}

export function OutlinePane({ entries, activeId, onJump, onClose }: Props) {
  // Indent relative to the shallowest heading present, so a note that only
  // uses ## doesn't start one step in.
  const base = entries.reduce((m, e) => Math.min(m, e.level), 6);
  return (
    <aside className={styles.root} aria-label="Outline">
      <div className={styles.head}>
        <span className={styles.label}>Outline</span>
        <button className={styles.close} onClick={onClose} title={`Hide outline (${shortcutFor("toggle-outline")})`}>
          <CloseIcon size={12} />
        </button>
      </div>
      {entries.length === 0 ? (
        <p className={styles.empty}>No headings yet.</p>
      ) : (
        <nav className={styles.list}>
          {entries.map((e) => (
            <button
              key={e.id}
              className={`${styles.item} ${e.id === activeId ? styles.itemActive : ""}`}
              style={{ paddingLeft: `${10 + (e.level - base) * 12}px` }}
              onClick={() => onJump(e.id)}
              title={e.text || "Untitled heading"}
            >
              {e.text || <span className={styles.untitled}>Untitled heading</span>}
            </button>
          ))}
        </nav>
      )}
    </aside>
  );
}
