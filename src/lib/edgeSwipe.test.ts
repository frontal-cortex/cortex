import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGE, startKind, lockAxis, drawerProgress, settlesOpen } from "./edgeSwipe.ts";

test("only a touch at the left edge can pull the drawer out", () => {
  assert.equal(startKind(0, false), "open");
  assert.equal(startKind(EDGE, false), "open");
  assert.equal(startKind(EDGE + 1, false), null);
  assert.equal(startKind(200, false), null);
});

test("while the drawer is out, a touch anywhere can push it away", () => {
  assert.equal(startKind(5, true), "close");
  assert.equal(startKind(300, true), "close");
});

test("a touch that has barely moved is undecided", () => {
  assert.equal(lockAxis("open", 4, 3), undefined);
  assert.equal(lockAxis("close", -9, 9), undefined);
});

test("a mostly vertical move is a scroll, not a swipe", () => {
  assert.equal(lockAxis("open", 12, 30), false);
  assert.equal(lockAxis("close", -12, -30), false);
  assert.equal(lockAxis("open", 12, 11), false);
});

test("a horizontal move only counts in the swipe's own direction", () => {
  assert.equal(lockAxis("open", 20, 2), true);
  assert.equal(lockAxis("open", -20, 2), false);
  assert.equal(lockAxis("close", -20, 2), true);
  assert.equal(lockAxis("close", 20, 2), false);
});

test("the drawer follows the finger and stays within its width", () => {
  assert.equal(drawerProgress("open", 140, 280), 0.5);
  assert.equal(drawerProgress("open", 400, 280), 1);
  assert.equal(drawerProgress("open", -30, 280), 0);
  assert.equal(drawerProgress("close", -70, 280), 0.75);
  assert.equal(drawerProgress("close", 50, 280), 1);
  assert.equal(drawerProgress("close", -400, 280), 0);
});

test("a slow swipe commits past a third of the width, and snaps back short of it", () => {
  assert.equal(settlesOpen("open", 60, 1000, 280), false);
  assert.equal(settlesOpen("open", 110, 1000, 280), true);
  assert.equal(settlesOpen("close", -60, 1000, 280), true);
  assert.equal(settlesOpen("close", -110, 1000, 280), false);
});

test("a quick flick commits however short", () => {
  assert.equal(settlesOpen("open", 40, 60, 280), true);
  assert.equal(settlesOpen("close", -40, 60, 280), false);
});
