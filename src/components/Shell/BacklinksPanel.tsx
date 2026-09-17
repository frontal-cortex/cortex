import { useEffect, useState } from "react";
import { commands, Backlink } from "../../lib/commands";
import styles from "./BacklinksPanel.module.css";

interface Props {
  path: string;
  onNavigate: (path: string) => void;
}

/**
 * "Linked from": every note that links to this one, and under each the
 * passage that does — the sentence around the link, the link itself set
 * off — so the reader sees what was said about this note, not only where.
 */
export function BacklinksPanel({ path, onNavigate }: Props) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);

  useEffect(() => {
    commands.getBacklinks(path).then(setBacklinks).catch(() => setBacklinks([]));
  }, [path]);

  if (backlinks.length === 0) return null;

  const mentions = backlinks.reduce((n, b) => n + b.mentions.length, 0);

  return (
    <div className={styles.root}>
      <p className={styles.label}>
        Linked from
        <span className={styles.count}>
          {backlinks.length}
          {mentions > backlinks.length && ` · ${mentions} mentions`}
        </span>
      </p>
      <div className={styles.list}>
        {backlinks.map((note) => (
          <div key={note.path} className={styles.source}>
            <button
              className={styles.item}
              onClick={() => onNavigate(note.path)}
            >
              <LinkIcon />
              <span className={styles.title}>{note.title || "Untitled"}</span>
              {note.mentions.length > 1 && (
                <span className={styles.mentions}>{note.mentions.length}</span>
              )}
              {note.note_type && (
                <span className={styles.type}>{note.note_type}</span>
              )}
            </button>
            {note.mentions.map((m, i) => (
              <button
                key={i}
                className={styles.mention}
                onClick={() => onNavigate(note.path)}
                title={`Open ${note.title || "Untitled"}`}
              >
                {m.before}
                <mark className={styles.link}>{m.link}</mark>
                {m.after}
              </button>
            ))}
          </div>
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
