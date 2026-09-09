// ── Gestures: the arithmetic behind touch + mouse input ─────────────────────
//
// Pure functions, no DOM, so the rules are testable with `npm run test:lib`.
// `lib/pointerDrag.ts` binds the drag state machine to pointer events; the
// graph and the timeline use the pinch / anchored-zoom helpers directly.
//
// One drag path for every pointer: a mouse or pen drags once it has moved
// `DRAG_THRESHOLD_PX`; a finger has to hold still for `TOUCH_HOLD_MS` first,
// because a finger that moves straight away is scrolling, and the browser
// must keep that gesture. That is what lets a list stay finger-scrollable
// without `touch-action: none` on every row.

export const DRAG_THRESHOLD_PX = 6;
export const TOUCH_HOLD_MS = 300;

export type PointerKind = "mouse" | "pen" | "touch";

export type DragPhase =
  /** Pointer is down; not yet a drag (a click, a tap or a scroll in the making). */
  | "pending"
  /** The drag is on: a ghost follows the pointer, drop targets light up. */
  | "dragging"
  /** Not a drag — the browser took the gesture (a scroll) or the pointer moved
   *  before a finger's hold elapsed. */
  | "cancelled";

export interface DragGesture {
  phase: DragPhase;
  kind: PointerKind;
  startX: number;
  startY: number;
  /** Whether the pointer has travelled `DRAG_THRESHOLD_PX` since it went down. */
  moved: boolean;
}

export function beginDrag(kind: PointerKind, x: number, y: number): DragGesture {
  return { phase: "pending", kind, startX: x, startY: y, moved: false };
}

/** The pointer moved to (x, y). */
export function dragMove(g: DragGesture, x: number, y: number): DragGesture {
  if (g.phase === "cancelled") return g;
  const moved = g.moved || Math.hypot(x - g.startX, y - g.startY) >= DRAG_THRESHOLD_PX;
  if (g.phase === "dragging") return moved === g.moved ? g : { ...g, moved };
  if (!moved) return g;
  // A finger that moves before its hold is a scroll, not a drag.
  if (g.kind === "touch") return { ...g, phase: "cancelled", moved };
  return { ...g, phase: "dragging", moved };
}

/** The touch hold timer elapsed: a still finger lifts the item. */
export function dragHold(g: DragGesture): DragGesture {
  if (g.phase !== "pending" || g.kind !== "touch") return g;
  return { ...g, phase: "dragging" };
}

/** Whether releasing now is a drop (a drag that actually travelled) — a lifted
 *  finger that never moved is a long-press, not a drop on whatever is under it. */
export function isDrop(g: DragGesture): boolean {
  return g.phase === "dragging" && g.moved;
}

/** A long-press: a finger held past the hold and released without moving. */
export function isLongPress(g: DragGesture): boolean {
  return g.kind === "touch" && g.phase === "dragging" && !g.moved;
}

// ── Pinch / zoom ──────────────────────────────────────────────────────────────

export interface Point { x: number; y: number }

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** The scale factor a pinch asks for: how far apart the fingers are now
 *  against where they started. A degenerate start (fingers together) is 1. */
export function pinchFactor(startDistance: number, currentDistance: number): number {
  return startDistance > 0 ? currentDistance / startDistance : 1;
}

/** Zoom a scrolled axis by `factor` keeping the content under the pointer
 *  still: `offset` is the pointer's distance from the scrolled edge (px),
 *  `scroll` the current scroll position. Returns the new scroll position. */
export function zoomAnchored(scroll: number, offset: number, factor: number): number {
  return Math.max(0, (scroll + offset) * factor - offset);
}

/** The zoom step a wheel notch asks for: in on scroll-up, out on scroll-down. */
export function wheelZoomFactor(deltaY: number, step = 1.1): number {
  return deltaY < 0 ? step : 1 / step;
}

// ── Edge auto-scroll ──────────────────────────────────────────────────────────

/** How fast (px per frame, signed) to scroll a container whose pointer sits
 *  `pos` px into an axis of `size` px, when within `margin` of either edge.
 *  0 in the middle; faster the closer to the edge. */
export function edgeScrollSpeed(pos: number, size: number, margin = 40, max = 12): number {
  if (size <= 0) return 0;
  if (pos < margin) return -Math.ceil(((margin - Math.max(0, pos)) / margin) * max);
  if (pos > size - margin) return Math.ceil(((pos - (size - margin)) / margin) * max);
  return 0;
}
