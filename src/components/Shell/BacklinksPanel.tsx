import { useCallback, useEffect, useState } from "react";
import { commands, Backlink, Outlink } from "../../lib/commands";
import { Snippet } from "./Snippet";
import styles from "./BacklinksPanel.module.css";

interface Props {
  path: string;
  /** The editor's save flag: when a save lands the lists are read again, so a
   *  link just typed shows up under "Links to" without leaving the note. */
  saving?: boolean;
  /** Open a note by path — or, given a `[[link]]` target that names no note,
   *  create it (the shell's navigate handler does both). */
  onNavigate: (target: string) => void;
}

/**
 * The open note's links, both ways. "Linked from" lists every note with a
 * `[[link]]` here, each with the lines the links sit on; "Links to" lists
 * where this note's own links land, with a Create action on any that name a
 * note that does not exist yet; "Unlinked mentions" lists notes that name
 * this one in plain text, with a Link action that turns those mentions into
 * links (rewriting the other note, never this one).
 */
export function BacklinksPanel({ path, saving = false, onNavigate }: Props) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [outgoing, setOutgoing] = useState<Outlink[]>([]);
  const [mentions, setMentions] = useState<Backlink[]>([]);
  const [outgoingOpen, setOutgoingOpen] = useState(false);
  const [mentionsOpen, setMentionsOpen] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    commands.getBacklinks(path).then((b) => live && setBacklinks(b)).catch(() => live && setBacklinks([]));
    commands.getOutgoingLinks(path).then((o) => live && setOutgoing(o)).catch(() => live && setOutgoing([]));
    commands.getUnlinkedMentions(path).then((m) => live && setMentions(m)).catch(() => live && setMentions([]));
    return () => { live = false; };
  }, [path]);

  useEffect(() => {
    setOutgoingOpen(false);
    setMentionsOpen(false);
    return load();
  }, [load]);

  // The save has landed and the index with it: read again.
  useEffect(() => {
    if (!saving) return load();
  }, [saving, load]);

  const unresolved = outgoing.filter((o) => !o.path).length;

  const link = async (source: string) => {
    setLinking(source);
    try {
      await commands.linkMentions(source, path);
    } finally {
      setLinking(null);
      load();
    }
  };

  if (backlinks.length === 0 && outgoing.length === 0 && mentions.length === 0) return null;

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

      {outgoing.length > 0 && (
        <>
          <button
            type="button"
            className={`${styles.label} ${styles.toggle}`}
            onClick={() => setOutgoingOpen((o) => !o)}
            aria-expanded={outgoingOpen}
          >
            <Chevron open={outgoingOpen} />
            Links to <span className={styles.count}>{outgoing.length}</span>
            {unresolved > 0 && (
              <span className={styles.hint}>{unresolved} not yet {unresolved === 1 ? "a note" : "notes"}</span>
            )}
          </button>
          {outgoingOpen && (
            <div className={styles.list}>
              {outgoing.map((o) => (
                <Target key={o.target.toLowerCase()} link={o} onNavigate={onNavigate} />
              ))}
            </div>
          )}
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

/** One place this note links to. Resolved: opens the note. Unresolved: the
 *  target as written, dimmed, with Create — which hands the target to the
 *  navigate handler, and that makes the note and opens it. */
function Target({ link, onNavigate }: { link: Outlink; onNavigate: (target: string) => void }) {
  const found = !!link.path;
  const label = found ? link.title || link.target : link.target;
  return (
    <div className={styles.entry}>
      <div className={styles.row}>
        <button
          className={`${styles.item} ${found ? "" : styles.missing}`}
          onClick={() => onNavigate(found ? link.path! : link.target)}
          title={found ? link.path : "No note has this name yet — Create makes one"}
        >
          <LinkIcon />
          <span className={styles.title}>{label || "Untitled"}</span>
          {link.count > 1 && <span className={styles.times}>×{link.count}</span>}
          {found && link.note_type && (
            <span className={styles.type}>{link.note_type}</span>
          )}
        </button>
        {!found && (
          <button
            type="button"
            className={styles.link}
            onClick={(e) => { e.stopPropagation(); onNavigate(link.target); }}
            title={`Create "${link.target}" in notes/ and open it`}
          >
            Create
          </button>
        )}
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
