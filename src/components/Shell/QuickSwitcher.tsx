import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { NoteEntry } from "../../lib/commands";
import styles from "./QuickSwitcher.module.css";

interface Props {
  notes: NoteEntry[];
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function QuickSwitcher({ notes, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = query.trim()
    ? notes.filter((n) =>
        n.title.toLowerCase().includes(query.toLowerCase()) ||
        n.path.toLowerCase().includes(query.toLowerCase()) ||
        n.tags.some((t) => t.toLowerCase().includes(query.toLowerCase())),
      )
    : notes.slice(0, 12);

  const clampedIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter" && filtered[clampedIndex]) {
      onSelect(filtered[clampedIndex].path);
      onClose();
    }
  }

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${clampedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputRow}>
          <SearchIcon />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Jump to note…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className={styles.esc}>Esc</kbd>
        </div>

        {filtered.length > 0 && (
          <div ref={listRef} className={styles.list}>
            {filtered.map((note, i) => (
              <button
                key={note.path}
                data-index={i}
                className={`${styles.item} ${i === clampedIndex ? styles.itemActive : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => { onSelect(note.path); onClose(); }}
              >
                <span className={styles.itemTitle}>{note.title || "Untitled"}</span>
                <span className={styles.itemPath}>{note.path}</span>
              </button>
            ))}
          </div>
        )}

        {query && filtered.length === 0 && (
          <p className={styles.empty}>No notes match "{query}"</p>
        )}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}
