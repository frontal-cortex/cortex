// ── Layout: which panes are open, and monk mode ─────────────────────────────
//
// Three switches. `left` (the sidebar) and `right` (the terminal pane) are
// remembered across launches. `monk` is a session-only overlay that hides
// everything but the writing surface — it never persists, so the app always
// comes back with its full chrome. Toggling a pane while in monk mode leaves
// monk mode: asking for the sidebar means you want the sidebar.
//
// At phone widths (`drawer`) the sidebar is an overlay drawer, not a pane: it
// starts closed, closes itself once you have picked something, and its state
// is never persisted — the desktop preference survives a trip through a
// narrow window untouched.

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

export function useLayout(drawer = false) {
  const [layout, setLayout] = useState<Layout>(load);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ left: layout.left, right: layout.right }));
    } catch { /* ignore */ }
  }, [layout.left, layout.right]);

  // Leaving drawer mode (the window grew) drops the drawer; the pane comes
  // back as it was.
  useEffect(() => { if (!drawer) setDrawerOpen(false); }, [drawer]);

  const toggleLeft = useCallback(() => {
    if (drawer) {
      setDrawerOpen((o) => !o);
      setLayout((l) => (l.monk ? { ...l, monk: false } : l));
      return;
    }
    setLayout((l) => ({ ...l, left: l.monk ? true : !l.left, monk: false }));
  }, [drawer]);
  const closeLeft = useCallback(() => {
    if (drawer) setDrawerOpen(false);
    else setLayout((l) => (l.left ? { ...l, left: false } : l));
  }, [drawer]);
  const toggleRight = useCallback(() => setLayout((l) => ({ ...l, right: l.monk ? true : !l.right, monk: false })), []);
  const toggleMonk = useCallback(() => setLayout((l) => ({ ...l, monk: !l.monk })), []);

  return {
    layout,
    /** What is actually on screen once monk mode is applied. */
    leftVisible: (drawer ? drawerOpen : layout.left) && !layout.monk,
    rightVisible: layout.right && !layout.monk,
    monk: layout.monk,
    toggleLeft,
    closeLeft,
    toggleRight,
    toggleMonk,
  };
}
