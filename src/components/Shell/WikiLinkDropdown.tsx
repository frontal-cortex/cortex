import { useEffect, useRef } from "react";
import { SuggestionCoords } from "../../lib/wikiLinkSuggestion";
import styles from "./WikiLinkDropdown.module.css";

/** A generic suggestion row — a note to link or a date to insert. */
export interface SuggestItem {
  key: string;
  title: string;
  badge?: string;
  subtitle?: string;
}

interface Props {
  query: string;
  items: SuggestItem[];
  coords: SuggestionCoords;
  activeIndex: number;
  emptyLabel?: string;
  onSelectIndex: (i: number) => void;
  onMouseEnterIndex?: (i: number) => void;
  onClose: () => void;
}

export function WikiLinkDropdown({
  query, items, coords, activeIndex, emptyLabel, onSelectIndex, onMouseEnterIndex, onClose,
}: Props) {
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

  if (items.length === 0 && !query) return null;

  // Flip above cursor if too close to the bottom of the viewport
  const spaceBelow = window.innerHeight - coords.bottom;
  const dropdownMaxH = Math.min(items.length * 36 + 8, 288);
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
      {items.length === 0 ? (
        <div className={styles.empty}>{emptyLabel ?? `No matches for "${query}"`}</div>
      ) : (
        items.map((item, i) => (
          <button
            key={item.key}
            data-idx={i}
            className={`${styles.item} ${i === activeIndex ? styles.itemActive : ""}`}
            onMouseDown={(e) => {
              // mousedown instead of click so it fires before the editor blur
              e.preventDefault();
              onSelectIndex(i);
            }}
            onMouseEnter={() => onMouseEnterIndex?.(i)}
          >
            <span className={styles.title}>{item.title}</span>
            {item.badge && <span className={styles.type}>{item.badge}</span>}
            {item.subtitle && <span className={styles.path}>{item.subtitle}</span>}
          </button>
        ))
      )}
      <div className={styles.hint}>
        <kbd>↑↓</kbd> navigate · <kbd>Enter</kbd> insert · <kbd>Esc</kbd> dismiss
      </div>
    </div>
  );
}
