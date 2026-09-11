// ── Columns ──────────────────────────────────────────────────────────────────
// A `columnList` block holds `column` blocks; each column's *children* are its
// content. Neither block has content of its own, so BlockNote's ordinary
// nesting (Tab / drag) does the work and no editor extension is needed — the
// side-by-side layout is CSS on the block group (index.css). On disk the list
// is `::: columns` … `:::` … `::: end` lines (src/lib/columns.ts).
//
// Why not @blocknote/xl-multi-column: it is GPL-3.0 or a paid licence, and
// this repository declares no licence, so pulling GPL code in would decide
// the question by accident.

import { createReactBlockSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { newColumnList } from "../../lib/columns";
import styles from "./ColumnBlocks.module.css";

const WIDTHS = ["1", "2", "3"];

function ColumnList({ block, editor }: { block: any; editor: any }) {
  const columns = (block.children ?? []).filter((c: any) => c.type === "column");
  const add = () => {
    editor.insertBlocks([{ type: "column", props: { width: "1" }, children: [{ type: "paragraph" }] }], columns.length ? columns[columns.length - 1] : block, columns.length ? "after" : "nested" as never);
  };
  return (
    <div className={styles.listBar} contentEditable={false}>
      <span className={styles.label}>{columns.length} columns</span>
      <button type="button" className={styles.small} onClick={add} title="Add a column">+ column</button>
    </div>
  );
}

function Column({ block, editor }: { block: any; editor: any }) {
  const width = String(block.props.width ?? "1");
  const cycle = () => {
    const i = WIDTHS.indexOf(width);
    editor.updateBlock(block, { props: { width: WIDTHS[(i + 1) % WIDTHS.length] } });
  };
  return (
    <div className={styles.colBar} contentEditable={false}>
      <button type="button" className={styles.small} onClick={cycle} title="Column width (1×, 2×, 3×)">{width}×</button>
    </div>
  );
}

export const columnListSpec = createReactBlockSpec(
  { type: "columnList", propSchema: { ratios: { default: "" } }, content: "none" },
  { render: (props) => <ColumnList block={props.block} editor={props.editor} /> },
)();

export const columnSpec = createReactBlockSpec(
  { type: "column", propSchema: { width: { default: "1" } }, content: "none" },
  { render: (props) => <Column block={props.block} editor={props.editor} /> },
)();

export function columnsSlashItems(editor: any): DefaultReactSuggestionItem[] {
  const item = (n: number): DefaultReactSuggestionItem => ({
    title: `${n} columns`,
    subtext: `Side by side; written as ::: columns fences, stacked on a phone`,
    aliases: ["columns", "layout", `${n} columns`, "side by side"],
    group: "Cortex",
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, newColumnList(n) as never);
      // Land the cursor in the first column's paragraph.
      setTimeout(() => {
        const list = editor.document.find((b: any) => b.type === "columnList" && (b.children ?? []).length === n && b.children.every((c: any) => (c.children ?? []).length === 1 && !(c.children[0].content?.length)));
        const first = list?.children?.[0]?.children?.[0];
        if (first) { try { editor.setTextCursorPosition(first.id, "start"); } catch { /* fine */ } }
      }, 0);
    },
  });
  return [item(2), item(3)];
}
