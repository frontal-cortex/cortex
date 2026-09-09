import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { parseWikiLink } from "./wikiLink";

const WIKI_LINK_RE = /\[\[([^\]\n]+)\]\]/g;

/**
 * Decorates [[wiki links]] in the editor as clickable spans.
 *
 * The text is stored as-is in the markdown file — no document structure
 * changes, no custom node types, no custom serialization required.
 * Pure visual overlay via ProseMirror decorations.
 *
 * `[[Note|alias]]` shows just the alias: the `[[Note|` and `]]` around it are
 * hidden until the cursor touches the link, then the whole thing is editable
 * as written. Every form hands its raw inner text to `onNavigate`, which
 * parses it (see `parseWikiLink`) — so `Note#Section` opens Note at Section.
 */
export function wikiLinkExtension(onNavigate: (target: string) => void) {
  return Extension.create({
    name: "wikiLink",

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("wikiLink"),

          props: {
            decorations(state) {
              const decorations: Decoration[] = [];
              const sel = state.selection;

              state.doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return;
                const re = new RegExp(WIKI_LINK_RE.source, "g");
                let match: RegExpExecArray | null;
                while ((match = re.exec(node.text)) !== null) {
                  const from = pos + match.index;
                  const to = from + match[0].length;
                  const inner = match[1];
                  const attrs = { class: "wiki-link", "data-wiki-target": inner.trim() };
                  const bar = inner.indexOf("|");
                  const touching = sel.from <= to && sel.to >= from;
                  if (bar === -1 || touching || !parseWikiLink(inner).alias) {
                    decorations.push(Decoration.inline(from, to, attrs));
                    continue;
                  }
                  // `[[Note|` … `alias` … `]]` — only the alias stays visible.
                  const aliasFrom = from + 2 + bar + 1;
                  const aliasTo = to - 2;
                  decorations.push(Decoration.inline(from, aliasFrom, { class: "wiki-link-syntax" }));
                  decorations.push(Decoration.inline(aliasFrom, aliasTo, attrs));
                  decorations.push(Decoration.inline(aliasTo, to, { class: "wiki-link-syntax" }));
                }
              });

              return DecorationSet.create(state.doc, decorations);
            },

            handleClick(_view, _pos, event) {
              const el = event.target as HTMLElement;
              const link = el.closest<HTMLElement>("[data-wiki-target]");
              if (link) {
                const target = link.getAttribute("data-wiki-target");
                if (target) {
                  onNavigate(target);
                  return true;
                }
              }
              return false;
            },
          },
        }),
      ];
    },
  });
}
