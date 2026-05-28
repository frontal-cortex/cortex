import { useEffect, useRef } from "react";
import { NoteEntry } from "../../lib/commands";
import { SuggestionCoords } from "../../lib/wikiLinkSuggestion";
import styles from "./WikiLinkDropdown.module.css";

interface Props {
  query: string;
  notes: NoteEntry[];
  coords: SuggestionCoords;
  activeIndex: number;
  onSelect: (title: string) => void;
  onClose: () => void;
}

export function WikiLinkDropdown({ query, notes, coords, activeIndex, onSelect, onClose }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll active item into view when activeIndex changes
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!listRef.current?.closest("[data-wiki-dropdown]")?.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  if (notes.length === 0 && !query) return null;

  // Flip above cursor if too close to the bottom of the viewport
  const spaceBelow = window.innerHeight - coords.bottom;
  const dropdownMaxH = Math.min(notes.length * 36 + 8, 288);
  const showAbove = spaceBelow < dropdownMaxH + 8;

  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(coords.left, window.innerWidth - 300),
    ...(showAbove
      ? { bottom: window.innerHeight - coords.bottom + 24 }
      : { top: coords.bottom + 4 }),
  };

  return (
    <div data-wiki-dropdown style={style} className={styles.root} ref={listRef}>
      {notes.length === 0 ? (
        <div className={styles.empty}>No notes match "{query}"</div>
      ) : (
        notes.map((note, i) => (
          <button
            key={note.path}
            data-idx={i}
            className={`${styles.item} ${i === activeIndex ? styles.itemActive : ""}`}
            onMouseDown={(e) => {
              // mousedown instead of click so it fires before the editor blur
              e.preventDefault();
              onSelect(note.title || pathToTitle(note.path));
            }}
            onMouseEnter={() => {
              // Hover just moves visual focus, doesn't update activeIndex state
              // (that's owned by the parent). We'd need a callback for this.
              // Keeping it simple for now.
            }}
          >
            <span className={styles.title}>{note.title || pathToTitle(note.path)}</span>
            {note.note_type && <span className={styles.type}>{note.note_type}</span>}
            <span className={styles.path}>{note.path.split("/").pop()?.replace(/\.md$/, "")}</span>
          </button>
        ))
      )}
      <div className={styles.hint}>
        <kbd>↑↓</kbd> navigate · <kbd>Enter</kbd> insert · <kbd>Esc</kbd> dismiss
      </div>
    </div>
  );
}

function pathToTitle(path: string) {
  return path.split("/").pop()?.replace(/\.md$/, "").replace(/-/g, " ") ?? "Untitled";
}
