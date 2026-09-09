// ── Sidebar width: a per-vault preference, remembered in localStorage ────────
//
// Pure chrome, so it never touches the vault: a wide sidebar on the desk and a
// narrow one on the laptop is the point, and syncing it would fight that.
// Clamped so the tree stays readable and the page keeps its room; the default
// matches `--left-panel-width` in tokens.css.

import { useCallback, useEffect, useState } from "react";

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 260;

const clamp = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));

function load(key: string): number {
  try {
    const n = Number(localStorage.getItem(key));
    if (Number.isFinite(n) && n > 0) return clamp(n);
  } catch { /* private mode, blocked storage — fall back to the default */ }
  return SIDEBAR_DEFAULT;
}

export function useSidebarWidth(vaultPath: string) {
  const key = `cortex.sidebarWidth:${vaultPath}`;
  const [width, setWidthState] = useState(() => load(key));
  useEffect(() => { setWidthState(load(key)); }, [key]);

  const setWidth = useCallback((w: number) => {
    const c = clamp(w);
    setWidthState(c);
    try { localStorage.setItem(key, String(c)); } catch { /* ignore */ }
  }, [key]);

  const reset = useCallback(() => {
    setWidthState(SIDEBAR_DEFAULT);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }, [key]);

  return { width, setWidth, reset };
}
