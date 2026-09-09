// ── Find in note ─────────────────────────────────────────────────────────────
//
// A ProseMirror plugin that highlights every occurrence of a query in the
// open note and tracks which one is "current". Pure overlay: decorations
// only, the document is never touched, nothing is stored. The React side
// (FindBar in Editor.tsx) drives it through `setFindQuery` / `stepFind` /
// `clearFind` and hears back through the `onState` callback.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

export interface FindMatch { from: number; to: number }

export interface FindState {
  query: string;
  matches: FindMatch[];
  /** Index into `matches`; meaningless when there are none. */
  active: number;
}

interface PluginState extends FindState {
  decorations: DecorationSet;
}

interface FindMeta {
  query?: string;
  /** +1 next, -1 previous. */
  step?: number;
  clear?: boolean;
}

const findKey = new PluginKey<PluginState>("cortexFind");

const EMPTY: PluginState = { query: "", matches: [], active: 0, decorations: DecorationSet.empty };

/** Case-insensitive search over every text block. Matches never cross a
 *  block boundary. Inline leaf nodes that aren't text (mentions, hard
 *  breaks) count as one opaque character so positions stay exact. */
export function findMatches(doc: PMNode, query: string): FindMatch[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const out: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const map: number[] = [];
    node.descendants((child, cpos) => {
      const abs = pos + 1 + cpos;
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) map.push(abs + i);
        text += child.text;
      } else if (child.isLeaf) {
        map.push(abs);
        text += "￼";
      }
      return true;
    });
    // Lower-casing can change the length of some scripts; fall back to an
    // exact search in that case rather than misplacing highlights.
    const hay = text.toLowerCase();
    const needle = hay.length === text.length ? q : query;
    const haystack = hay.length === text.length ? hay : text;
    let i = haystack.indexOf(needle);
    while (i !== -1) {
      out.push({ from: map[i], to: map[i + needle.length - 1] + 1 });
      i = haystack.indexOf(needle, i + needle.length);
    }
    return false;
  });
  return out;
}

function build(doc: PMNode, query: string, matches: FindMatch[], active: number): PluginState {
  const decorations = DecorationSet.create(doc, matches.map((m, i) =>
    Decoration.inline(m.from, m.to, { class: i === active ? "cortex-find-match cortex-find-match-active" : "cortex-find-match" }),
  ));
  return { query, matches, active, decorations };
}

/** The first match at or after the selection, else the first one. */
function nearest(matches: FindMatch[], from: number): number {
  const i = matches.findIndex((m) => m.from >= from);
  return i === -1 ? 0 : i;
}

function apply(tr: Transaction, prev: PluginState): PluginState {
  const meta = tr.getMeta(findKey) as FindMeta | undefined;
  if (meta?.clear) return EMPTY;
  const query = meta?.query ?? prev.query;
  if (!query) return EMPTY;
  const requery = meta?.query !== undefined || tr.docChanged;
  const matches = requery ? findMatches(tr.doc, query) : prev.matches;
  let active = prev.active;
  if (meta?.query !== undefined && meta.query !== prev.query) active = nearest(matches, tr.selection.from);
  if (meta?.step && matches.length) active = (active + meta.step + matches.length) % matches.length;
  if (matches.length) active = Math.min(Math.max(active, 0), matches.length - 1); else active = 0;
  if (!requery && !meta?.step && active === prev.active) return prev;
  return build(tr.doc, query, matches, active);
}

export function findInNoteExtension(onState: (s: FindState) => void) {
  return Extension.create({
    name: "cortexFind",
    addProseMirrorPlugins() {
      return [new Plugin<PluginState>({
        key: findKey,
        state: { init: () => EMPTY, apply },
        props: { decorations: (state) => findKey.getState(state)?.decorations ?? DecorationSet.empty },
        view: () => ({
          update(view, prevState) {
            const s = findKey.getState(view.state);
            if (s && s !== findKey.getState(prevState)) onState({ query: s.query, matches: s.matches, active: s.active });
          },
        }),
      })];
    },
  });
}

function scrollToActive(view: EditorView) {
  const s = findKey.getState(view.state);
  const m = s?.matches[s.active];
  if (!m) return;
  const { node } = view.domAtPos(m.from);
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  el?.scrollIntoView({ block: "center" });
}

/** Search for `query`; the current match becomes the one nearest the cursor. */
export function setFindQuery(view: EditorView, query: string) {
  view.dispatch(view.state.tr.setMeta(findKey, { query } satisfies FindMeta));
  scrollToActive(view);
}

/** Move to the next (+1) or previous (-1) match, wrapping. */
export function stepFind(view: EditorView, step: 1 | -1) {
  view.dispatch(view.state.tr.setMeta(findKey, { step } satisfies FindMeta));
  scrollToActive(view);
}

/** Drop the highlights. With `select`, leave the cursor on the current match
 *  so Escape hands you back to the text you were looking for. */
export function clearFind(view: EditorView, select = false) {
  const s = findKey.getState(view.state);
  const m = s?.matches[s.active];
  let tr = view.state.tr.setMeta(findKey, { clear: true } satisfies FindMeta);
  if (select && m) tr = tr.setSelection(TextSelection.create(tr.doc, m.from, m.to));
  view.dispatch(tr);
}

export function findStateOf(state: EditorState): FindState {
  const s = findKey.getState(state) ?? EMPTY;
  return { query: s.query, matches: s.matches, active: s.active };
}
