import { useState, useEffect, useRef } from "react";
import { NoteEntry } from "../../lib/commands";
import { commands } from "../../lib/commands";
import styles from "./NoteList.module.css";

interface Props {
  notes: NoteEntry[];
  loading: boolean;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onNewNote: () => void;
}

export function NoteList({ notes, loading, selectedPath, onSelect, onNewNote }: Props) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NoteEntry[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced backend search; fall back to client-side for empty query
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);

    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    searchTimer.current = setTimeout(async () => {
      try {
        const results = await commands.searchNotes(query);
        setSearchResults(results);
      } catch {
        // Index not ready yet — fall back to client-side filter
        const q = query.toLowerCase();
        setSearchResults(
          notes.filter(
            (n) =>
              n.title.toLowerCase().includes(q) ||
              n.tags.some((t) => t.toLowerCase().includes(q)),
          ),
        );
      }
    }, 200);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, notes]);

  const displayed = searchResults ?? notes;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchIcon />
          <input
            className={styles.searchInput}
            placeholder="Search notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className={styles.clearBtn} onClick={() => setQuery("")}>
              ×
            </button>
          )}
        </div>
        <button className={styles.newBtn} onClick={onNewNote} title="New note">
          <PlusIcon />
        </button>
      </div>

      <div className={styles.list}>
        {loading && <p className={styles.empty}>Loading…</p>}
        {!loading && displayed.length === 0 && (
          <p className={styles.empty}>
            {query ? "No matches" : "No notes yet — create one to get started."}
          </p>
        )}
        {displayed.map((note) => (
          <NoteRow
            key={note.path}
            note={note}
            active={note.path === selectedPath}
            onClick={() => onSelect(note.path)}
          />
        ))}
      </div>
    </div>
  );
}

function NoteRow({
  note,
  active,
  onClick,
}: {
  note: NoteEntry;
  active: boolean;
  onClick: () => void;
}) {
  const date = new Date(note.modified * 1000);
  const dateStr = formatDate(date);

  return (
    <button
      className={`${styles.row} ${active ? styles.rowActive : ""}`}
      onClick={onClick}
    >
      <div className={styles.rowMain}>
        <span className={styles.rowTitle}>{note.title || "Untitled"}</span>
        {note.note_type && (
          <span className={styles.rowType}>{note.note_type}</span>
        )}
      </div>
      <div className={styles.rowMeta}>
        {note.tags.slice(0, 2).map((tag) => (
          <span key={tag} className={styles.tag}>
            {tag}
          </span>
        ))}
        <span className={styles.date}>{dateStr}</span>
      </div>
    </button>
  );
}

function formatDate(date: Date): string {
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
