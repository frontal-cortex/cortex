import { useEffect, useState } from "react";
import { commands, NoteEntry } from "../../lib/commands";
import styles from "./BacklinksPanel.module.css";

interface Props {
  path: string;
  onNavigate: (path: string) => void;
}

export function BacklinksPanel({ path, onNavigate }: Props) {
  const [backlinks, setBacklinks] = useState<NoteEntry[]>([]);

  useEffect(() => {
    commands.getBacklinks(path).then(setBacklinks).catch(() => setBacklinks([]));
  }, [path]);

  if (backlinks.length === 0) return null;

  return (
    <div className={styles.root}>
      <p className={styles.label}>Linked from</p>
      <div className={styles.list}>
        {backlinks.map((note) => (
          <button
            key={note.path}
            className={styles.item}
            onClick={() => onNavigate(note.path)}
          >
            <LinkIcon />
            <span className={styles.title}>{note.title || "Untitled"}</span>
            {note.note_type && (
              <span className={styles.type}>{note.note_type}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function LinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  );
}
