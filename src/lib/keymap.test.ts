// Run with `npm run test:lib` (node's built-in runner; no bundler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHORTCUTS, SHORTCUT_AREAS, conflictFor, shortcutsByArea } from "./keymap.ts";
import type { ShortcutId } from "./keymap.ts";

const ids = Object.keys(SHORTCUTS) as ShortcutId[];

test("no two default shortcuts share a combo", () => {
  for (const id of ids) {
    assert.equal(conflictFor(SHORTCUTS[id].keys, id), null, `${id} collides`);
  }
});

test("every shortcut has a listed area and the overlay lists every shortcut once", () => {
  const listed = shortcutsByArea().flatMap((g) => g.ids);
  assert.deepEqual([...listed].sort(), [...ids].sort());
  for (const id of ids) assert.ok(SHORTCUT_AREAS.includes(SHORTCUTS[id].area), `${id} has an unknown area`);
});

test("the help overlay is on mod+/", () => {
  assert.equal(SHORTCUTS["shortcut-help"].keys, "mod+/");
});
