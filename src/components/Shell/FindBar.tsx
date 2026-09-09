// ── Find in note ─────────────────────────────────────────────────────────────
// A small bar over the page: type to highlight, Enter / Shift+Enter to step,
// Escape to close and land on the current match. The matching itself is the
// ProseMirror plugin in lib/findInNote.ts; this is only its controls.

import { useEffect, useRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "./icons";
import styles from "./FindBar.module.css";

interface Props {
  query: string;
  count: number;
  /** 0-based index of the current match. */
  active: number;
  /** Bumped by the shell when the shortcut fires while the bar is already open. */
  focusToken: number;
  onQuery: (q: string) => void;
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
}

export function FindBar({ query, count, active, focusToken, onQuery, onStep, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, [focusToken]);

  const status = !query ? "" : count === 0 ? "No matches" : `${active + 1} of ${count}`;

  return (
    <div className={styles.root} role="search" aria-label="Find in note">
      <input
        ref={inputRef}
        className={styles.input}
        value={query}
        placeholder="Find in note…"
        spellCheck={false}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onStep(e.shiftKey ? -1 : 1); }
          else if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}
      />
      <span className={`${styles.count} ${query && count === 0 ? styles.countNone : ""}`}>{status}</span>
      <button className={styles.btn} onClick={() => onStep(-1)} disabled={count === 0} title="Previous match (Shift+Enter)">
        <ChevronLeftIcon size={14} />
      </button>
      <button className={styles.btn} onClick={() => onStep(1)} disabled={count === 0} title="Next match (Enter)">
        <ChevronRightIcon size={14} />
      </button>
      <button className={styles.btn} onClick={onClose} title="Close (Esc)">
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
