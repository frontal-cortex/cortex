import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

export interface SuggestionCoords {
  left: number;
  bottom: number;
}

/** What opened the suggestion: a `[[` wiki link, an `@` mention, or a `#` tag. */
export type SuggestionTrigger = "wiki" | "mention" | "tag";

export interface SuggestionHandle {
  /** Called from ProseMirror; React updates the dropdown via this. */
  keyHandler: React.MutableRefObject<((key: string) => boolean) | null>;
  /** Stable wrappers — set these from the component side. */
  callbacks: React.MutableRefObject<{
    onOpen: (query: string, coords: SuggestionCoords, from: number, trigger: SuggestionTrigger) => void;
    onUpdate: (query: string, coords: SuggestionCoords, from: number, trigger: SuggestionTrigger) => void;
    onClose: () => void;
  }>;
}

interface PluginState {
  active: boolean;
  query: string;
  from: number;
  trigger: SuggestionTrigger;
}

const PLUGIN_KEY = new PluginKey<PluginState>("wikiLinkSuggestion");

function detectSuggestion(state: EditorState): PluginState {
  const inactive: PluginState = { active: false, query: "", from: 0, trigger: "wiki" };
  const { selection } = state;

  // Only act on a plain cursor (no range selection)
  if (!selection.empty) return inactive;
  const $cursor = (selection as { $cursor?: { parent: { textContent: string }; parentOffset: number; start: () => number } }).$cursor;
  if (!$cursor) return inactive;

  // Text in the current block before the cursor
  const textBefore = $cursor.parent.textContent.slice(0, $cursor.parentOffset);

  // `[[ ` wiki link — takes precedence (it can legitimately contain an @).
  const openIdx = textBefore.lastIndexOf("[[");
  if (openIdx !== -1) {
    const afterBrackets = textBefore.slice(openIdx + 2);
    // Bail if already closed or if a second [[ was opened
    if (!afterBrackets.includes("]]") && !afterBrackets.includes("[[")) {
      return { active: true, query: afterBrackets, from: $cursor.start() + openIdx, trigger: "wiki" };
    }
  }

  // `@` mention — only at a word boundary, and the query ends at the first space.
  const atIdx = textBefore.lastIndexOf("@");
  if (atIdx !== -1) {
    const before = atIdx === 0 ? " " : textBefore[atIdx - 1];
    const afterAt = textBefore.slice(atIdx + 1);
    if (/\s/.test(before) && !/[\s@[\]]/.test(afterAt)) {
      return { active: true, query: afterAt, from: $cursor.start() + atIdx, trigger: "mention" };
    }
  }

  // `#tag` — at a word boundary (start, whitespace or `(`, the same rule the
  // indexer applies), and the query runs only while tag characters continue.
  // `# ` at a line start is a heading: the space ends the query at once.
  const hashIdx = textBefore.lastIndexOf("#");
  if (hashIdx !== -1) {
    const before = hashIdx === 0 ? " " : textBefore[hashIdx - 1];
    const afterHash = textBefore.slice(hashIdx + 1);
    if ((/\s/.test(before) || before === "(") && /^[\p{L}\p{N}_\-/]*$/u.test(afterHash)) {
      return { active: true, query: afterHash, from: $cursor.start() + hashIdx, trigger: "tag" };
    }
  }

  return inactive;
}

/**
 * TipTap Extension that detects when the cursor is inside an unclosed [[...
 * and fires open/update/close callbacks so React can render the dropdown.
 *
 * Keyboard events (↑↓ Enter Tab Escape) are forwarded to keyHandler while
 * the suggestion is active.
 */
export function wikiLinkSuggestionExtension(handle: SuggestionHandle) {
  return Extension.create({
    name: "wikiLinkSuggestion",

    addProseMirrorPlugins() {
      return [
        new Plugin<PluginState>({
          key: PLUGIN_KEY,

          state: {
            init: () => ({ active: false, query: "", from: 0, trigger: "wiki" }),
            apply(_tr, _prev, _oldState, newState) {
              return detectSuggestion(newState);
            },
          },

          view() {
            return {
              update(view: EditorView, prevEditorState: EditorState) {
                const prev = PLUGIN_KEY.getState(prevEditorState);
                const next = PLUGIN_KEY.getState(view.state);
                if (!next) return;

                const coords = (): SuggestionCoords => {
                  const c = view.coordsAtPos(view.state.selection.from);
                  return { left: c.left, bottom: c.bottom };
                };

                if (next.active && !prev?.active) {
                  handle.callbacks.current.onOpen(next.query, coords(), next.from, next.trigger);
                } else if (next.active && prev?.active && (next.query !== prev.query || next.trigger !== prev.trigger)) {
                  handle.callbacks.current.onUpdate(next.query, coords(), next.from, next.trigger);
                } else if (!next.active && prev?.active) {
                  handle.callbacks.current.onClose();
                }
              },
              destroy() {},
            };
          },

          props: {
            handleKeyDown(_view: EditorView, event: KeyboardEvent): boolean {
              const state = PLUGIN_KEY.getState(_view.state);
              if (!state?.active) return false;

              const NAV_KEYS = ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"];
              if (!NAV_KEYS.includes(event.key)) return false;

              const handled = handle.keyHandler.current?.(event.key) ?? false;
              if (handled) event.preventDefault();
              return handled;
            },
          },
        }),
      ];
    },
  });
}
