// The editor's block schema: BlockNote's defaults plus Cortex's own blocks.
// Kept in its own module so the block files can import each other's helpers
// without a cycle through the schema.

import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { cortexViewSpec } from "./CortexViewBlock";
import { noteEmbedSpec } from "./NoteEmbedBlock";
import { calloutSpec } from "./CalloutBlock";
import { collectionViewsSpec } from "./CollectionViewsBlock";
import { codeBlockSpec } from "./codeBlock";
import { mathBlockSpec, inlineMathSpec } from "./MathBlock";
import { bookmarkSpec } from "./BookmarkBlock";
import { webEmbedSpec } from "./WebEmbedBlock";

export const cortexSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: codeBlockSpec,
    cortexView: cortexViewSpec,
    noteEmbed: noteEmbedSpec,
    callout: calloutSpec,
    collectionViews: collectionViewsSpec,
    mathBlock: mathBlockSpec,
    bookmark: bookmarkSpec,
    webEmbed: webEmbedSpec,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    inlineMath: inlineMathSpec,
  },
});
