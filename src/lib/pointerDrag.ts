// ── Pointer drag-and-drop: one path for mouse, pen and touch ────────────────
//
// HTML5 drag-and-drop never fires on a touch screen, so the tree, the board
// and anything else that moves things by dragging goes through here instead.
// A source calls `startPointerDrag` from its `onPointerDown`; the session
// then listens on the document for the rest of the gesture (so the pointer
// may leave the element), decides with `lib/gestures.ts` whether it is a
// drag at all (a mouse: after a few pixels; a finger: after a still hold, so
// a list stays finger-scrollable), draws a ghost, lights up the drop target
// under the pointer with a `data-drop-over` attribute, auto-scrolls the
// nearest scroll container near its edges, and hands the payload to the
// target's `onDrop` on release.
//
// Drop targets register with `registerDropTarget(el, onDrop)` (the
// `useDropTarget` hook wraps it). They carry `data-drop` so the innermost
// registered ancestor of whatever is under the pointer wins — a folder row
// inside the Notes section, say.
//
// While a drag is on, `<html>` carries `data-dragging`, so a stylesheet can
// pause scroll-snap or hide hover affordances for its duration.

import {
  DragGesture, PointerKind, TOUCH_HOLD_MS, beginDrag, dragMove, dragHold, isDrop, isLongPress,
  edgeScrollSpeed,
} from "./gestures";

export interface DragSourceOptions {
  /** What the drop receives: a note path, a `collection:` handle, a row id. */
  payload: string;
  /** Text for the ghost that follows the pointer (the source's text by default). */
  label?: string;
  /** Long-press on touch (held, released without moving) opens the source's
   *  context menu — the touch stand-in for a right click. */
  contextMenuOnHold?: boolean;
}

type DropHandler = (payload: string, e: PointerEvent) => void;

const targets = new WeakMap<Element, DropHandler>();

/** Make `el` a drop target. Returns the unregister function. */
export function registerDropTarget(el: HTMLElement, onDrop: DropHandler): () => void {
  targets.set(el, onDrop);
  el.setAttribute("data-drop", "");
  return () => {
    targets.delete(el);
    el.removeAttribute("data-drop");
    el.removeAttribute("data-drop-over");
  };
}

/** The registered drop target under the point, if any. */
function targetAt(x: number, y: number): HTMLElement | null {
  let el: Element | null = document.elementFromPoint(x, y);
  while (el) {
    el = el.closest("[data-drop]");
    if (!el) return null;
    if (targets.has(el)) return el as HTMLElement;
    el = el.parentElement;
  }
  return null;
}

/** The nearest ancestor that scrolls on either axis. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    const y = /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight;
    const x = /(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth;
    if (x || y) return n;
  }
  return null;
}

let active: (() => void) | null = null;

/** Whether a pointer drag is in progress right now. */
export function isPointerDragging(): boolean {
  return !!active;
}

/** Call from a source element's `onPointerDown` with the element and the
 *  native event. Only the primary button (or a finger / pen) starts anything;
 *  a modifier click is left alone. */
export function startPointerDrag(source: HTMLElement, ev: PointerEvent, opts: DragSourceOptions): void {
  if (!ev.isPrimary || (ev.pointerType !== "touch" && ev.button !== 0)) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  active?.();

  const kind = (ev.pointerType === "touch" ? "touch" : ev.pointerType === "pen" ? "pen" : "mouse") as PointerKind;
  let g: DragGesture = beginDrag(kind, ev.clientX, ev.clientY);
  const pointerId = ev.pointerId;
  let last = { x: ev.clientX, y: ev.clientY };
  let ghost: HTMLDivElement | null = null;
  let over: HTMLElement | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let raf = 0;
  const scroller = scrollParent(source);
  let started = false;

  const lift = () => {
    if (started) return;
    started = true;
    document.documentElement.setAttribute("data-dragging", "");
    source.setAttribute("data-dragging", "");
    ghost = document.createElement("div");
    ghost.textContent = opts.label ?? (source.innerText || "").split("\n")[0].trim().slice(0, 60);
    Object.assign(ghost.style, {
      position: "fixed", left: "0", top: "0", zIndex: "5000", pointerEvents: "none",
      maxWidth: "240px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
      padding: "6px 10px", borderRadius: "6px",
      background: "var(--bg-panel, #fff)", color: "var(--text-primary, #000)",
      border: "1px solid var(--border-focus, var(--border, #999))",
      boxShadow: "0 6px 20px rgba(0, 0, 0, 0.2)", fontSize: "13px", opacity: "0.95",
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(ghost);
    // A finger past its hold must not hand the gesture to the scroller now.
    document.addEventListener("touchmove", preventTouch, { passive: false });
    placeGhost();
    tick();
  };

  const placeGhost = () => {
    if (ghost) ghost.style.transform = `translate(${last.x + 12}px, ${last.y + 12}px)`;
  };

  const setOver = (el: HTMLElement | null) => {
    if (el === over) return;
    over?.removeAttribute("data-drop-over");
    over = el;
    over?.setAttribute("data-drop-over", "");
  };

  // Near an edge of the scroll container the view creeps along so a long
  // list or a wide board can be crossed without lifting the pointer.
  const tick = () => {
    raf = 0;
    if (scroller && g.phase === "dragging" && g.moved) {
      const r = scroller.getBoundingClientRect();
      const dy = edgeScrollSpeed(last.y - r.top, r.height);
      const dx = edgeScrollSpeed(last.x - r.left, r.width);
      if (dy || dx) {
        if (dy && scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop += dy;
        if (dx && scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft += dx;
        setOver(targetAt(last.x, last.y));
      }
    }
    if (started) raf = requestAnimationFrame(tick);
  };

  const preventTouch = (te: TouchEvent) => { if (te.cancelable) te.preventDefault(); };
  const swallow = (ce: Event) => { ce.preventDefault(); ce.stopPropagation(); };
  // The click that follows a real drag would open whatever was dragged.
  const swallowClick = (ce: Event) => { ce.stopPropagation(); ce.preventDefault(); };

  const onMove = (me: PointerEvent) => {
    if (me.pointerId !== pointerId) return;
    last = { x: me.clientX, y: me.clientY };
    g = dragMove(g, me.clientX, me.clientY);
    if (g.phase === "cancelled") { finish(); return; }
    if (g.phase !== "dragging") return;
    lift();
    placeGhost();
    if (g.moved) {
      setOver(targetAt(me.clientX, me.clientY));
      if (!raf) tick();
    }
  };

  const onUp = (ue: PointerEvent) => {
    if (ue.pointerId !== pointerId) return;
    const drop = isDrop(g) ? targetAt(ue.clientX, ue.clientY) : null;
    const longPress = isLongPress(g) && !!opts.contextMenuOnHold;
    const wasDrag = isDrop(g);
    finish();
    if (drop) targets.get(drop)?.(opts.payload, ue);
    if (wasDrag) {
      document.addEventListener("click", swallowClick, true);
      setTimeout(() => document.removeEventListener("click", swallowClick, true), 0);
    }
    if (longPress) {
      source.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: ue.clientX, clientY: ue.clientY }));
    }
  };

  const onCancel = (ce: PointerEvent) => { if (ce.pointerId === pointerId) finish(); };
  const onKey = (ke: KeyboardEvent) => { if (ke.key === "Escape") finish(); };

  const finish = () => {
    if (holdTimer) clearTimeout(holdTimer);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    setOver(null);
    ghost?.remove();
    ghost = null;
    source.removeAttribute("data-dragging");
    document.documentElement.removeAttribute("data-dragging");
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("touchmove", preventTouch);
    document.removeEventListener("contextmenu", swallow, true);
    started = false;
    if (active === finish) active = null;
  };
  active = finish;

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onCancel);
  document.addEventListener("keydown", onKey, true);

  if (kind === "touch") {
    // The browser's own long-press menu would land mid-hold and end the
    // touch; ours (when the source wants one) comes on release instead.
    document.addEventListener("contextmenu", swallow, true);
    holdTimer = setTimeout(() => {
      holdTimer = null;
      g = dragHold(g);
      if (g.phase === "dragging") lift();
    }, TOUCH_HOLD_MS);
  }
}
