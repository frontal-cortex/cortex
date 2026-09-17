import { useCallback, useEffect, useState } from "react";
import { commands, Backlink } from "../../lib/commands";
import { Snippet } from "./Snippet";
import styles from "./BacklinksPanel.module.css";

interface Props {
  path: string;
  onNavigate: (path: string) => void;
}

/**
 * What points at the open note. "Linked from" lists every note with a
 * `[[link]]` here, each with the lines the links sit on; "Unlinked mentions"
 * lists notes that name this one in plain text, with a Link action that turns
 * those mentions into links (rewriting the other note, never this one).
 */
export function BacklinksPanel({ path, onNavigate }: Props) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [mentions, setMentions] = useState<Backlink[]>([]);
  const [mentionsOpen, setMentionsOpen] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    commands.getBacklinks(path).then((b) => live && setBacklinks(b)).catch(() => live && setBacklinks([]));
    commands.getUnlinkedMentions(path).then((m) => live && setMentions(m)).catch(() => live && setMentions([]));
    return () => { live = false; };
  }, [path]);

  useEffect(() => {
    setMentionsOpen(false);
    return load();
  }, [load]);

  const link = async (source: string) => {
    setLinking(source);
    try {
      await commands.linkMentions(source, path);
    } finally {
      setLinking(null);
      load();
    }
  };

  if (backlinks.length === 0 && mentions.length === 0) return null;

  return (
    <div className={styles.root}>
      {backlinks.length > 0 && (
        <>
          <p className={styles.label}>
            Linked from <span className={styles.count}>{backlinks.length}</span>
          </p>
          <div className={styles.list}>
            {backlinks.map((note) => (
              <Referrer key={note.path} note={note} onNavigate={onNavigate} />
            ))}
          </div>
        </>
      )}

      {mentions.length > 0 && (
        <>
          <button
            type="button"
            className={`${styles.label} ${styles.toggle}`}
            onClick={() => setMentionsOpen((o) => !o)}
            aria-expanded={mentionsOpen}
          >
            <Chevron open={mentionsOpen} />
            Unlinked mentions <span className={styles.count}>{mentions.length}</span>
          </button>
          {mentionsOpen && (
            <div className={styles.list}>
              {mentions.map((note) => (
                <Referrer
                  key={note.path}
                  note={note}
                  onNavigate={onNavigate}
                  action={
                    <button
                      type="button"
                      className={styles.link}
                      disabled={linking === note.path}
                      onClick={(e) => { e.stopPropagation(); link(note.path); }}
                      title="Turn every mention in this note into a [[link]]"
                    >
                      {linking === note.path ? "Linking…" : "Link"}
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Referrer({ note, onNavigate, action }: { note: Backlink; onNavigate: (path: string) => void; action?: React.ReactNode }) {
  return (
    <div className={styles.entry}>
      <div className={styles.row}>
        <button className={styles.item} onClick={() => onNavigate(note.path)}>
          <LinkIcon />
          <span className={styles.title}>{note.title || "Untitled"}</span>
          {note.note_type && (
            <span className={styles.type}>{note.note_type}</span>
          )}
        </button>
        {action}
      </div>
      {note.contexts.length > 0 && (
        <div className={styles.contexts}>
          {note.contexts.map((line, i) => (
            <button key={i} className={styles.context} onClick={() => onNavigate(note.path)} title={note.path}>
              <Snippet text={line} />
            </button>
          ))}
        </div>
      )}
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
