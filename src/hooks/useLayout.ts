// ── Layout: which panes are open, and monk mode ─────────────────────────────
//
// Three switches. `left` (the sidebar) and `right` (the terminal pane) are
// remembered across launches. `monk` is a session-only overlay that hides
// everything but the writing surface — it never persists, so the app always
// comes back with its full chrome. Toggling a pane while in monk mode leaves
// monk mode: asking for the sidebar means you want the sidebar.
//
// `typingHidden` is a fourth, quieter switch: the sidebar stepping aside
// while you write (hooks/useTypingFocus.ts). Like monk mode it is session
// only and leaves the remembered preference alone, and any deliberate reach
// for the sidebar — the toggle, its shortcut, the left edge — clears it, so
// the switch can never strand someone without a sidebar.
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
  const [typingHidden, setTypingHidden] = useState(false);

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
    // Asking for a sidebar that typing took away means "give it back", not
    // "close the one I cannot see".
    let restored = false;
    setTypingHidden((t) => { restored = t; return false; });
    if (restored) { setLayout((l) => ({ ...l, left: true, monk: false })); return; }
    setLayout((l) => ({ ...l, left: l.monk ? true : !l.left, monk: false }));
  }, [drawer]);
  const closeLeft = useCallback(() => {
    setTypingHidden(false);
    if (drawer) setDrawerOpen(false);
    else setLayout((l) => (l.left ? { ...l, left: false } : l));
  }, [drawer]);
  const toggleRight = useCallback(() => setLayout((l) => ({ ...l, right: l.monk ? true : !l.right, monk: false })), []);
  const toggleMonk = useCallback(() => { setTypingHidden(false); setLayout((l) => ({ ...l, monk: !l.monk })); }, []);
  const hideForTyping = useCallback(() => setTypingHidden(true), []);
  const showAfterTyping = useCallback(() => setTypingHidden(false), []);

  return {
    layout,
    /** What is actually on screen once monk mode and typing focus apply. */
    leftVisible: (drawer ? drawerOpen : layout.left) && !layout.monk && !typingHidden,
    rightVisible: layout.right && !layout.monk,
    monk: layout.monk,
    /** The sidebar is away because of typing, not because of a choice. */
    typingHidden,
    toggleLeft,
    closeLeft,
    toggleRight,
    toggleMonk,
    hideForTyping,
    showAfterTyping,
  };
}
