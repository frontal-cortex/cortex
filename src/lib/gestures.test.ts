// Run with `npm run test:lib` (node's built-in runner; no bundler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DRAG_THRESHOLD_PX, beginDrag, dragMove, dragHold, isDrop, isLongPress,
  pinchFactor, zoomAnchored, wheelZoomFactor, edgeScrollSpeed, distance, midpoint, clamp,
} from "./gestures.ts";

test("a mouse drags once it has travelled the threshold", () => {
  let g = beginDrag("mouse", 10, 10);
  assert.equal(g.phase, "pending");
  g = dragMove(g, 12, 11);
  assert.equal(g.phase, "pending");
  assert.equal(g.moved, false);
  g = dragMove(g, 10 + DRAG_THRESHOLD_PX, 10);
  assert.equal(g.phase, "dragging");
  assert.equal(isDrop(g), true);
  assert.equal(isLongPress(g), false);
});

test("a finger that moves before the hold is a scroll, not a drag", () => {
  let g = beginDrag("touch", 0, 0);
  g = dragMove(g, 0, 20);
  assert.equal(g.phase, "cancelled");
  // Nothing revives a cancelled gesture — not the hold, not more movement.
  assert.equal(dragHold(g).phase, "cancelled");
  assert.equal(dragMove(g, 0, 40).phase, "cancelled");
  assert.equal(isDrop(g), false);
});

test("a still finger lifts the item on hold and drops it once it has moved", () => {
  let g = beginDrag("touch", 0, 0);
  g = dragMove(g, 2, 2);
  assert.equal(g.phase, "pending");
  g = dragHold(g);
  assert.equal(g.phase, "dragging");
  // Held and released in place: a long-press, never a drop on itself.
  assert.equal(isLongPress(g), true);
  assert.equal(isDrop(g), false);
  g = dragMove(g, 30, 0);
  assert.equal(isLongPress(g), false);
  assert.equal(isDrop(g), true);
});

test("the hold means nothing to a mouse", () => {
  const g = beginDrag("mouse", 0, 0);
  assert.equal(dragHold(g).phase, "pending");
  assert.equal(dragHold(beginDrag("pen", 0, 0)).phase, "pending");
});

test("pinch factor is the spread of the fingers, and degenerate starts are 1", () => {
  assert.equal(pinchFactor(100, 200), 2);
  assert.equal(pinchFactor(100, 50), 0.5);
  assert.equal(pinchFactor(0, 50), 1);
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.deepEqual(midpoint({ x: 0, y: 0 }, { x: 4, y: 2 }), { x: 2, y: 1 });
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
});

test("anchored zoom keeps the content under the pointer where it is", () => {
  // Content point under the pointer: scroll 100 + offset 50 = 150. Doubling
  // puts it at 300; keeping it 50px from the edge means scroll 250.
  assert.equal(zoomAnchored(100, 50, 2), 250);
  // Zooming out never scrolls past the start.
  assert.equal(zoomAnchored(10, 50, 0.5), 0);
  // At the pointer's own position nothing moves when the factor is 1.
  assert.equal(zoomAnchored(120, 33, 1), 120);
});

test("wheel notches zoom in on scroll-up, out on scroll-down", () => {
  assert.equal(wheelZoomFactor(-100), 1.1);
  assert.ok(Math.abs(wheelZoomFactor(100) - 1 / 1.1) < 1e-12);
  assert.equal(wheelZoomFactor(-1, 2), 2);
});

test("edge auto-scroll is idle in the middle and grows toward the edges", () => {
  assert.equal(edgeScrollSpeed(200, 400), 0);
  assert.ok(edgeScrollSpeed(5, 400) < 0);
  assert.ok(edgeScrollSpeed(395, 400) > 0);
  assert.ok(Math.abs(edgeScrollSpeed(0, 400)) > Math.abs(edgeScrollSpeed(30, 400)));
  assert.equal(edgeScrollSpeed(0, 400), -12);
  assert.equal(edgeScrollSpeed(400, 400), 12);
  assert.equal(edgeScrollSpeed(10, 0), 0);
});
