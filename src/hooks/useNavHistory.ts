/**
 * Single-note navigation history with back/forward, held in memory.
 *
 * Stack and cursor live in ONE state object and every transition is a functional
 * update, so `navigate` has no dependencies and can never read a stale cursor
 * (the previous tab-aware version did, which corrupted history and left the
 * editor unable to open a note).
 */
import { useState, useCallback } from "react";

const MAX_HISTORY = 50;

interface NavState {
  stack: string[];
  index: number; // -1 = nothing open
}

export function useNavHistory() {
  const [{ stack, index }, setNav] = useState<NavState>({ stack: [], index: -1 });

  const currentPath: string | null = index >= 0 ? stack[index] ?? null : null;

  /** Navigate to a path (pushing history). Pass "" to deselect. */
  const navigate = useCallback((path: string) => {
    setNav((s) => {
      if (!path) return { stack: [], index: -1 };
      if (s.stack[s.index] === path) return s; // already here — no-op
      const base = s.stack.slice(0, s.index + 1);
      const next = [...base, path].slice(-MAX_HISTORY);
      return { stack: next, index: next.length - 1 };
    });
  }, []);

  const back = useCallback(() => {
    setNav((s) => ({ ...s, index: Math.max(s.index - 1, 0) }));
  }, []);

  const forward = useCallback(() => {
    setNav((s) => ({ ...s, index: Math.min(s.index + 1, s.stack.length - 1) }));
  }, []);

  const canBack = index > 0;
  const canForward = index >= 0 && index < stack.length - 1;

  return { currentPath, canBack, canForward, navigate, back, forward };
}
