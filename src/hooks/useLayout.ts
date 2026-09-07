// ── Layout: which panes are open, and monk mode ─────────────────────────────
//
// Three switches. `left` (the sidebar) and `right` (the terminal pane) are
// remembered across launches. `monk` is a session-only overlay that hides
// everything but the writing surface — it never persists, so the app always
// comes back with its full chrome. Toggling a pane while in monk mode leaves
// monk mode: asking for the sidebar means you want the sidebar.

import { useCallback, useEffect, useState } from "react";

export interface Layout {
  left: boolean;
  right: boolean;
  monk: boolean;
}

const KEY = "cortex.layout";
const DEFAULT: Layout = { left: true, right: false, monk: false };

function load(): Layout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw), monk: false };
  } catch { /* private mode, blocked storage — fall back to defaults */ }
  return DEFAULT;
}

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ left: layout.left, right: layout.right }));
    } catch { /* ignore */ }
  }, [layout.left, layout.right]);

  const toggleLeft = useCallback(() => setLayout((l) => ({ ...l, left: l.monk ? true : !l.left, monk: false })), []);
  const toggleRight = useCallback(() => setLayout((l) => ({ ...l, right: l.monk ? true : !l.right, monk: false })), []);
  const toggleMonk = useCallback(() => setLayout((l) => ({ ...l, monk: !l.monk })), []);

  return {
    layout,
    /** What is actually on screen once monk mode is applied. */
    leftVisible: layout.left && !layout.monk,
    rightVisible: layout.right && !layout.monk,
    monk: layout.monk,
    toggleLeft,
    toggleRight,
    toggleMonk,
  };
}
