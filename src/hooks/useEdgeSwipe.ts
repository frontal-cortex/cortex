// Touch gesture for the phone drawer: swipe in from the left edge to pull the
// sidebar out, swipe left to push it away. The drawer follows the finger by
// inline style (no re-render per frame); on release the state changes and the
// drawer's own CSS transition finishes the slide. Rules in lib/edgeSwipe.ts.

import { RefObject, useEffect, useRef } from "react";
import { startKind, lockAxis, drawerProgress, settlesOpen, SwipeKind } from "../lib/edgeSwipe";

interface Options {
  /** Phone layout only; off in focus mode. */
  enabled: boolean;
  open: boolean;
  drawer: RefObject<HTMLElement | null>;
  backdrop: RefObject<HTMLElement | null>;
  onOpen: () => void;
  onClose: () => void;
}

export function useEdgeSwipe({ enabled, open, drawer, backdrop, onOpen, onClose }: Options) {
  const latest = useRef({ open, onOpen, onClose });
  latest.current = { open, onOpen, onClose };

  useEffect(() => {
    if (!enabled) return;
    let kind: SwipeKind | null = null;
    let locked: boolean | undefined;
    let x0 = 0, y0 = 0, t0 = 0, dx = 0;

    const clear = () => {
      for (const el of [drawer.current, backdrop.current]) {
        if (!el) continue;
        el.style.transition = "";
        el.style.marginLeft = "";
        el.style.visibility = "";
        el.style.opacity = "";
      }
    };

    const onStart = (e: TouchEvent) => {
      kind = e.touches.length === 1 ? startKind(e.touches[0].clientX, latest.current.open) : null;
      if (!kind) return;
      locked = undefined;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      t0 = e.timeStamp;
      dx = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!kind || locked === false) return;
      const t = e.touches[0];
      dx = t.clientX - x0;
      if (locked === undefined) {
        locked = lockAxis(kind, dx, t.clientY - y0);
        if (!locked) return;
      }
      // Ours now: no page scroll or text selection under the swipe.
      e.preventDefault();
      const el = drawer.current;
      if (!el) return;
      const width = el.offsetWidth;
      const p = drawerProgress(kind, dx, width);
      el.style.transition = "none";
      el.style.visibility = "visible";
      el.style.marginLeft = `${-(1 - p) * width}px`;
      if (backdrop.current) {
        backdrop.current.style.transition = "none";
        backdrop.current.style.opacity = String(p);
      }
    };

    const onEnd = (e: TouchEvent) => {
      const swiped = kind && locked;
      const k = kind;
      kind = null;
      if (!swiped || !k) return;
      const width = drawer.current?.offsetWidth ?? 1;
      const out = settlesOpen(k, dx, e.timeStamp - t0, width);
      if (out && !latest.current.open) latest.current.onOpen();
      if (!out && latest.current.open) latest.current.onClose();
      // Let the new state's classes land first, so dropping the inline
      // position slides from where the finger left the drawer.
      requestAnimationFrame(clear);
    };

    const onCancel = () => {
      if (kind && locked) requestAnimationFrame(clear);
      kind = null;
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onCancel);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
      clear();
    };
  }, [enabled, drawer, backdrop]);
}
