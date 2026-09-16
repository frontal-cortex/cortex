// ── Swiping the phone drawer ─────────────────────────────────────────────────
// The rules for the sidebar drawer's touch gesture, apart from the DOM so they
// can be tested: a swipe from the left edge pulls the drawer out, a swipe left
// while it is out pushes it away. The drawer follows the finger and, on
// release, settles whichever way the swipe went far or fast enough.

/** How close to the left edge (px) a swipe must start to pull the drawer out. */
export const EDGE = 24;
/** Travel (px) before a touch counts as a swipe or a scroll. */
export const LOCK = 10;
/** Share of the drawer's width that commits a slow swipe. */
export const COMMIT = 0.35;
/** Speed (px/ms) that commits a flick however short. */
export const FLICK = 0.4;

export type SwipeKind = "open" | "close";

/** What a touch starting at `x` could become: pulling the drawer out (only
 *  from the edge), pushing it away (from anywhere while it is out), or nothing. */
export function startKind(x: number, open: boolean): SwipeKind | null {
  if (open) return "close";
  return x <= EDGE ? "open" : null;
}

/** Whether the touch has become this swipe: `undefined` while it has barely
 *  moved, `false` once it is a scroll or went the other way. */
export function lockAxis(kind: SwipeKind, dx: number, dy: number): boolean | undefined {
  if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return undefined;
  const horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
  const rightWay = kind === "open" ? dx > 0 : dx < 0;
  return horizontal && rightWay;
}

/** How far out the drawer is while held, from 0 (away) to 1 (all the way out). */
export function drawerProgress(kind: SwipeKind, dx: number, width: number): number {
  const p = kind === "open" ? dx / width : 1 + dx / width;
  return Math.min(1, Math.max(0, p));
}

/** On release after `dt` ms: whether the drawer ends up out. */
export function settlesOpen(kind: SwipeKind, dx: number, dt: number, width: number): boolean {
  const velocity = dx / Math.max(dt, 1);
  if (kind === "open") return dx / width >= COMMIT || velocity >= FLICK;
  return !(-dx / width >= COMMIT || velocity <= -FLICK);
}
