// ── Comment anchors ──────────────────────────────────────────────────────────
//
// A comment thread points at a passage by quoting it: `{ quote, occurrence }`
// (see crates/cortex-core/src/comments.rs). This module is the editor side of
// that contract — find the nth exact occurrence of a quote in the live
// document, build an anchor from the current selection, and highlight the
// selected thread's passage with a decoration. Pure overlay: nothing here
// ever changes the document or writes a file.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { findMatches, type FindMatch } from "./findInNote";
import type { CommentAnchor } from "./commands";

/** The document range the anchor names, or null when the quoted passage is
 *  no longer in the note (the thread then reads as a note-level comment). */
export function locateAnchor(doc: PMNode, anchor: CommentAnchor | null | undefined): FindMatch | null {
  if (!anchor?.quote) return null;
  return findMatches(doc, anchor.quote, true)[anchor.occurrence ?? 0] ?? null;
}

/** An anchor for the current selection: its text (first block only — a
 *  quote never crosses a paragraph) and which occurrence of that text it
 *  is. Null for an empty selection. */
export function anchorForSelection(state: EditorState): CommentAnchor | null {
  const { from, to } = state.selection;
  if (from === to) return null;
  const quote = state.doc.textBetween(from, to, "\n").split("\n")[0].trim();
  if (!quote) return null;
  const before = findMatches(state.doc, quote, true).filter((m) => m.from < from);
  return { quote, occurrence: before.length };
}

interface PluginState {
  anchor: CommentAnchor | null;
  decorations: DecorationSet;
}

const key = new PluginKey<PluginState>("cortexCommentAnchor");
const EMPTY: PluginState = { anchor: null, decorations: DecorationSet.empty };

function build(doc: PMNode, anchor: CommentAnchor | null): PluginState {
  const m = locateAnchor(doc, anchor);
  const decorations = m
    ? DecorationSet.create(doc, [Decoration.inline(m.from, m.to, { class: "cortex-comment-anchor" })])
    : DecorationSet.empty;
  return { anchor, decorations };
}

function apply(tr: Transaction, prev: PluginState): PluginState {
  const meta = tr.getMeta(key) as { anchor: CommentAnchor | null } | undefined;
  if (meta) return build(tr.doc, meta.anchor);
  if (!prev.anchor) return prev;
  if (tr.docChanged) return build(tr.doc, prev.anchor);
  return prev;
}

export function commentAnchorExtension() {
  return Extension.create({
    name: "cortexCommentAnchor",
    addProseMirrorPlugins() {
      return [new Plugin<PluginState>({
        key,
        state: { init: () => EMPTY, apply },
        props: { decorations: (state) => key.getState(state)?.decorations ?? DecorationSet.empty },
      })];
    },
  });
}

/** Highlight this anchor's passage (null clears), scrolling it into view. */
export function setCommentHighlight(view: EditorView, anchor: CommentAnchor | null, scroll = true) {
  view.dispatch(view.state.tr.setMeta(key, { anchor }));
  if (!scroll || !anchor) return;
  const m = locateAnchor(view.state.doc, anchor);
  if (!m) return;
  const { node } = view.domAtPos(m.from);
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
}
