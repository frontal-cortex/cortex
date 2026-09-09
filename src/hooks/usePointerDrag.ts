// ── Drag sources and drop targets, as React props ───────────────────────────
// Thin bindings over lib/pointerDrag.ts: `dragSource(opts)` spreads onto the
// element you pick up (a tree row, a board card); `useDropTarget(onDrop)`
// gives a ref for the element things land on. Mouse, pen and touch all take
// the same path — see the lib for the gesture rules.

import { useCallback, useEffect, useRef } from "react";
import { DragSourceOptions, registerDropTarget, startPointerDrag } from "../lib/pointerDrag";

/** Props for an element that can be dragged. */
export function dragSource(opts: DragSourceOptions): { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void } {
  return {
    onPointerDown: (e) => {
      // A button or a field inside the row keeps its own pointer.
      const t = e.target as HTMLElement;
      if (t.closest("button, input, textarea, select, a, [contenteditable=\"true\"]")) return;
      startPointerDrag(e.currentTarget, e.nativeEvent, opts);
    },
  };
}

/** A ref for an element that receives dropped payloads. The handler may
 *  change between renders; the latest one runs. */
export function useDropTarget<T extends HTMLElement = HTMLElement>(
  onDrop: (payload: string, e: PointerEvent) => void,
): (el: T | null) => void {
  const handler = useRef(onDrop);
  useEffect(() => { handler.current = onDrop; }, [onDrop]);
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = el ? registerDropTarget(el, (p, e) => handler.current(p, e)) : null;
  }, []);
}
