import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

// ── Sidebar row model ─────────────────────────────────────────────────────────
//
// Everything in the sidebar that can take focus is a row in one flat list —
// section headers, folders, notes, databases, trash entries, and inline
// actions like "Create one". LeftPanel derives that list from the same open/
// closed state the renderer uses, so ArrowDown always lands on the next thing
// the eye sees, regardless of which section it belongs to. The list is the
// keyboard's whole world; the DOM is only consulted to move focus.

export type TreeRowKind = "section" | "dir" | "tag" | "note" | "collection" | "trash" | "action";

export interface TreeRow {
  id: string;
  kind: TreeRowKind;
  /** What type-ahead matches against. */
  label: string;
  depth: number;
  parentId: string | null;
  /** Section, dir and (nested) tag rows only. */
  expanded?: boolean;
  /** Vault-relative path for note/dir rows; collection index path for databases; the full tag for tag rows. */
  path?: string;
  /** Where `n` creates a note from this row. */
  folder?: string;
  /** Primary action for action/collection/trash rows (Enter or click). */
  run?: () => void;
  /** What Delete does when it isn't "delete the note": unpin a favorite,
   *  purge a trash entry, dismiss a first-run tip. */
  remove?: () => void;
}

/** ARIA + roving-tabindex attributes a rendered row spreads onto its element. */
export interface RowA11y {
  role: "treeitem";
  tabIndex: 0 | -1;
  "data-row-id": string;
  "aria-selected"?: boolean;
  "aria-expanded"?: boolean;
  "aria-level": number;
  onFocus: () => void;
}

// ── Roving tabindex ───────────────────────────────────────────────────────────
//
// Exactly one row is reachable with Tab (tabIndex 0); the rest are -1. Whatever
// row last had focus is that one, so tabbing away and back returns you where
// you were. If that row has since vanished (deleted, or its folder collapsed
// with the mouse) the fallback keeps the tree reachable.

export function useRovingRows(rows: TreeRow[], fallbackId: string | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // A focus request for a row that isn't rendered yet (it appears after the
  // state update that asked for it) is honoured after the next commit.
  const pendingFocus = useRef<string | null>(null);

  const ids = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const effectiveActiveId =
    activeId && ids.has(activeId) ? activeId
    : fallbackId && ids.has(fallbackId) ? fallbackId
    : rows[0]?.id ?? null;

  const rowElement = useCallback((id: string): HTMLElement | null => {
    const root = containerRef.current;
    if (!root) return null;
    return root.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
  }, []);

  /** Move focus (and the roving tabindex) to a row, scrolling it into view. */
  const focusRow = useCallback((id: string | null) => {
    if (!id) return;
    const el = rowElement(id);
    if (!el) { pendingFocus.current = id; setActiveId(id); return; }
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  }, [rowElement]);

  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const el = rowElement(id);
    if (el) {
      pendingFocus.current = null;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
    }
  });

  const rowA11y = useCallback((row: TreeRow, selected?: boolean): RowA11y => ({
    role: "treeitem",
    tabIndex: row.id === effectiveActiveId ? 0 : -1,
    "data-row-id": row.id,
    "aria-level": row.depth + 1,
    ...(selected !== undefined ? { "aria-selected": selected } : {}),
    ...(row.expanded !== undefined ? { "aria-expanded": row.expanded } : {}),
    onFocus: () => setActiveId(row.id),
  }), [effectiveActiveId]);

  return { containerRef, activeId: effectiveActiveId, setActiveId, focusRow, rowA11y };
}

// ── Type-ahead ────────────────────────────────────────────────────────────────
//
// File-manager style: letters typed in quick succession form a prefix, and the
// next row (after the current one, wrapping) whose label starts with it takes
// focus. A pause of `resetMs` starts a fresh prefix.

export function useTypeAhead(resetMs = 600) {
  const state = useRef({ buffer: "", at: 0 });

  return useCallback((rows: TreeRow[], fromIndex: number, char: string): TreeRow | null => {
    const now = Date.now();
    const fresh = now - state.current.at > resetMs;
    const buffer = (fresh ? "" : state.current.buffer) + char.toLowerCase();
    state.current = { buffer, at: now };

    // A single repeated letter cycles through matches; a growing prefix stays
    // on the current row while it still matches.
    const start = buffer.length === 1 ? fromIndex + 1 : fromIndex;
    for (let step = 0; step < rows.length; step++) {
      const row = rows[(start + step + rows.length) % rows.length];
      if (row.label.toLowerCase().startsWith(buffer)) return row;
    }
    return null;
  }, [resetMs]);
}
