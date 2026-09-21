/** A block whose chrome is its own business.
 *
 *  The blocks that hold views, buttons and embeds are `contentEditable={false}`,
 *  but a tap inside one still reaches ProseMirror's mousedown handler, which
 *  selects the clicked node and focuses the editor. On a desktop that is
 *  invisible; on a phone focusing the editor slides the keyboard up over
 *  whatever was just tapped — a tab, a gear, a row.
 *
 *  Marking the wrapper with this attribute and answering ProseMirror's
 *  `handleDOMEvents.mousedown` with `tapIsBlockChrome` leaves the tap to the
 *  block: the click still fires, nothing is focused, no keyboard.
 */
export const BLOCK_CHROME = { "data-block-chrome": "" } as const;

/** A text field inside such a block still needs the focus it is being given.
 *  The search stops at the block: every element in the editor has the editor's
 *  own contenteditable root above it, which would otherwise count as a field
 *  and exempt every tap there is. */
const EDITABLE = "input, textarea, select, [contenteditable='true'], [contenteditable='']";

export function tapIsBlockChrome(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const chrome = el?.closest?.("[data-block-chrome]");
  if (!chrome) return false;
  const field = el!.closest(EDITABLE);
  return !(field && chrome.contains(field));
}
