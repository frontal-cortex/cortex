// ── Typing focus: the sidebar steps aside while you write ────────────────────
// Owns the timer and the listeners; the rule itself is lib/typingFocus.ts.
//
// It hides nothing you chose: the remembered sidebar preference is untouched,
// this is a session-only overlay (useLayout's `typingHidden`). Three things
// bring it straight back — the pointer at the left edge, Escape, and the focus
// leaving the page — on top of the toggle and its shortcut, which are always
// on screen.

import { useEffect, useRef } from "react";
import { EDGE_PX, TypingRun, isTypingKey, nextCheckIn, noteKey, shouldHide } from "../lib/typingFocus";

export interface TypingFocusOptions {
  /** Seconds of typing before the sidebar goes; 0 = off. */
  seconds: number;
  /** False while there is nothing to hide (a phone drawer, monk mode). */
  enabled: boolean;
  /** Whether the sidebar is currently hidden by this. */
  hidden: boolean;
  onHide: () => void;
  onShow: () => void;
  /** The writing surface. Typing anywhere else (search, the palette) is not
   *  writing. */
  selector?: string;
}

export function useTypingFocus({ seconds, enabled, hidden, onHide, onShow, selector = ".bn-editor" }: TypingFocusOptions) {
  // The callbacks change every render; the listeners should not.
  const latest = useRef({ onHide, onShow, hidden, enabled, seconds, selector });
  latest.current = { onHide, onShow, hidden, enabled, seconds, selector };

  const run = useRef<TypingRun | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    };
    const inEditor = (node: EventTarget | null) =>
      node instanceof Node && (node instanceof Element ? node : node.parentElement)?.closest(latest.current.selector) != null;

    const reveal = () => {
      run.current = null;
      clear();
      if (latest.current.hidden) latest.current.onShow();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const { seconds: secs, enabled: on } = latest.current;
      if (e.key === "Escape") { reveal(); return; }
      if (!on || secs <= 0) return;
      if (!inEditor(e.target)) return;
      if (!isTypingKey(e)) return;
      const now = Date.now();
      run.current = noteKey(run.current, now);
      if (timer.current !== null) return; // already waiting for this run to come of age
      const wait = nextCheckIn(run.current, now, secs * 1000);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const state = latest.current;
        if (!state.enabled || state.hidden || state.seconds <= 0) return;
        if (!shouldHide(run.current, Date.now(), state.seconds * 1000)) return;
        if (!inEditor(document.activeElement)) return;
        state.onHide();
      }, wait);
    };

    // Reaching for the sidebar: the pointer at the window's left edge.
    const onPointerMove = (e: PointerEvent) => {
      if (latest.current.hidden && e.clientX <= EDGE_PX) reveal();
    };

    // Moving on: the focus lands outside the page (a view block, the
    // terminal, a dialog).
    const onFocusIn = (e: FocusEvent) => {
      if (latest.current.hidden && !inEditor(e.target)) reveal();
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      clear();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, []);

  // The setting turned off, or the layout changing under it, ends any run.
  useEffect(() => {
    if (!enabled || seconds <= 0) {
      run.current = null;
      if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    }
  }, [enabled, seconds]);
}
