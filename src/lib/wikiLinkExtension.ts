import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

const WIKI_LINK_RE = /\[\[([^\]\n]+)\]\]/g;

/**
 * Decorates [[wiki links]] in the editor as clickable spans.
 *
 * The text is stored as-is in the markdown file — no document structure
 * changes, no custom node types, no custom serialization required.
 * Pure visual overlay via ProseMirror decorations.
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

              state.doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return;
                const re = new RegExp(WIKI_LINK_RE.source, "g");
                let match: RegExpExecArray | null;
                while ((match = re.exec(node.text)) !== null) {
                  decorations.push(
                    Decoration.inline(
                      pos + match.index,
                      pos + match.index + match[0].length,
                      {
                        class: "wiki-link",
                        "data-wiki-target": match[1].trim(),
                      },
                    ),
                  );
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
