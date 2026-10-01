/**
 * Single-note navigation history with back/forward, held in memory and — in a
 * browser — mirrored into the address bar.
 *
 * Stack and cursor live in ONE state object and every transition is a functional
 * update, so `navigate` has no dependencies and can never read a stale cursor
 * (the previous tab-aware version did, which corrupted history and left the
 * editor unable to open a note).
 *
 * The address bar matters on a phone, where there is no sidebar in sight: a note
 * at `/n/<path>` can be bookmarked, kept on a home screen, sent to someone, and
 * — the one that makes the app worth returning to — survives the reload a phone
 * does whenever it reclaims a backgrounded tab. Opening a note pushes a history
 * entry so the system back gesture walks back through what you read; the app's
 * own arrows rewrite the address instead of stacking duplicates on top of it.
 * In the desktop app the address is the app's own shell, so it is left alone.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { noteUrl, notePathFromUrl } from "../lib/noteUrl";
import { capabilities } from "../lib/host";

const MAX_HISTORY = 50;

interface NavState {
  stack: string[];
  index: number; // -1 = nothing open
}

/** How the next address change should be written. */
type UrlMode = "push" | "replace" | "none";

function addressed(): boolean {
  return capabilities().served && typeof window !== "undefined" && !!window.history;
}

function pathInAddress(): string | null {
  if (typeof window === "undefined") return null;
  return notePathFromUrl(window.location.pathname);
}

export function useNavHistory() {
  const [{ stack, index }, setNav] = useState<NavState>(() => {
    const opened = addressed() ? pathInAddress() : null;
    return opened ? { stack: [opened], index: 0 } : { stack: [], index: -1 };
  });
  const urlMode = useRef<UrlMode>("replace");

  const currentPath: string | null = index >= 0 ? stack[index] ?? null : null;

  /** Navigate to a path (pushing history). Pass "" to deselect. */
  const navigate = useCallback((path: string) => {
    urlMode.current = "push";
    setNav((s) => {
      if (!path) return { stack: [], index: -1 };
      if (s.stack[s.index] === path) return s; // already here — no-op
      const base = s.stack.slice(0, s.index + 1);
      const next = [...base, path].slice(-MAX_HISTORY);
      return { stack: next, index: next.length - 1 };
    });
  }, []);

  const back = useCallback(() => {
    urlMode.current = "replace";
    setNav((s) => ({ ...s, index: Math.max(s.index - 1, 0) }));
  }, []);

  const forward = useCallback(() => {
    urlMode.current = "replace";
    setNav((s) => ({ ...s, index: Math.min(s.index + 1, s.stack.length - 1) }));
  }, []);

  // The address follows the open note.
  useEffect(() => {
    if (!addressed()) return;
    const mode = urlMode.current;
    urlMode.current = "replace";
    if (mode === "none") return;
    const want = currentPath ? noteUrl(currentPath) : "/";
    if (window.location.pathname === want) return;
    try {
      if (mode === "push") window.history.pushState({ note: currentPath }, "", want);
      else window.history.replaceState({ note: currentPath }, "", want);
    } catch { /* an address the browser will not take is not worth an error */ }
  }, [currentPath]);

  // …and the open note follows the address, when the system back gesture or the
  // browser's own buttons move it.
  useEffect(() => {
    if (!addressed()) return;
    const onPop = () => {
      const path = pathInAddress();
      urlMode.current = "none";
      setNav((s) => {
        if (!path) return { stack: s.stack, index: -1 };
        if (s.stack[s.index] === path) return s;
        const at = s.stack.lastIndexOf(path);
        if (at >= 0) return { ...s, index: at };
        const next = [...s.stack.slice(0, s.index + 1), path].slice(-MAX_HISTORY);
        return { stack: next, index: next.length - 1 };
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const canBack = index > 0;
  const canForward = index >= 0 && index < stack.length - 1;

  return { currentPath, canBack, canForward, navigate, back, forward };
}
