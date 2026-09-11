import test from "node:test";
import assert from "node:assert/strict";
import { IDLE_MS, isTypingKey, nextCheckIn, noteKey, shouldHide } from "./typingFocus.ts";

const key = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
  ({ key: "a", ctrlKey: false, metaKey: false, altKey: false, ...over });

test("a run starts at the first key and survives the pauses inside a sentence", () => {
  let run = noteKey(null, 1000);
  assert.deepEqual(run, { startedAt: 1000, lastAt: 1000 });
  run = noteKey(run, 2000);
  run = noteKey(run, 3500);
  assert.deepEqual(run, { startedAt: 1000, lastAt: 3500 }, "same run through a 1.5s think");
});

test("a long pause starts a fresh run", () => {
  const first = noteKey(null, 1000);
  const later = noteKey(first, 1000 + IDLE_MS + 1);
  assert.equal(later.startedAt, 1000 + IDLE_MS + 1);
});

test("hides once the run is five seconds old and still going", () => {
  // Keys within the idle window keep one run alive across the five seconds.
  let run = noteKey(null, 0);
  for (const at of [2000, 4000, 4900]) run = noteKey(run, at);
  assert.equal(run.startedAt, 0, "one run, not four");
  assert.equal(shouldHide(run, 5000, 5000), true);
  assert.equal(shouldHide(run, 4999, 5000), false, "not yet five seconds");
});

test("a run that restarted mid-way is not five seconds old yet", () => {
  const run = noteKey(noteKey(null, 0), 4900); // a long gap: a fresh run
  assert.equal(run.startedAt, 4900);
  assert.equal(shouldHide(run, 5000, 5000), false);
});

test("typing two words and stopping never hides", () => {
  const run = noteKey(null, 0); // one keystroke, then silence
  assert.equal(shouldHide(run, 5000, 5000), false, "the run went stale before its time");
});

test("no run, or the setting off, hides nothing", () => {
  assert.equal(shouldHide(null, 5000, 5000), false);
  assert.equal(shouldHide(noteKey(null, 0), 60_000, 0), false);
});

test("the next check lands when the run comes of age", () => {
  const run = noteKey(null, 1000);
  assert.equal(nextCheckIn(run, 1000, 5000), 5000);
  assert.equal(nextCheckIn(run, 4000, 5000), 2000);
  assert.equal(nextCheckIn(run, 9000, 5000), 0, "never negative");
});

test("writing keys count, commands and navigation do not", () => {
  assert.equal(isTypingKey(key()), true);
  assert.equal(isTypingKey(key({ key: " " })), true);
  assert.equal(isTypingKey(key({ key: "Enter" })), true);
  assert.equal(isTypingKey(key({ key: "Backspace" })), true);
  assert.equal(isTypingKey(key({ key: "ArrowDown" })), false);
  assert.equal(isTypingKey(key({ key: "Escape" })), false);
  assert.equal(isTypingKey(key({ key: "Tab" })), false);
  assert.equal(isTypingKey(key({ key: "k", metaKey: true })), false, "mod+k is the palette");
  assert.equal(isTypingKey(key({ key: "b", ctrlKey: true })), false);
});
