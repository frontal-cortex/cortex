import test from "node:test";
import assert from "node:assert/strict";
import { tapIsBlockChrome } from "./editorFocus.ts";

/** The two ancestors that matter, as `closest` sees them: the block wrapper and
 *  the nearest editable field. The editor's own contenteditable root sits above
 *  every element in the document, so "a field" is not the same as "a field
 *  inside this block". */
function target({ chrome, field, fieldInChrome = true }: { chrome: boolean; field: boolean; fieldInChrome?: boolean }) {
  const chromeEl = { contains: (_x: unknown) => fieldInChrome };
  return {
    closest(selector: string) {
      if (selector === "[data-block-chrome]") return chrome ? chromeEl : null;
      return field ? {} : null;
    },
  } as unknown as EventTarget;
}

test("a tap on a block's own chrome is the block's, not the editor's", () => {
  assert.equal(tapIsBlockChrome(target({ chrome: true, field: false })), true, "a tab or a gear");
  assert.equal(tapIsBlockChrome(target({ chrome: false, field: false })), false, "prose: the editor takes it");
});

test("a text field inside the block still gets its focus", () => {
  assert.equal(tapIsBlockChrome(target({ chrome: true, field: true })), false, "a row's search box");
});

test("the editor's own contenteditable root does not count as a field", () => {
  assert.equal(
    tapIsBlockChrome(target({ chrome: true, field: true, fieldInChrome: false })),
    true,
    "the only editable ancestor is the editor itself, above the block",
  );
});

test("a tap with no element behind it is nobody's", () => {
  assert.equal(tapIsBlockChrome(null), false);
});
