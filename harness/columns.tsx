// Dev-only harness: renders the app's editor schema with a column layout in a
// plain browser so the block DOM and the layout CSS can be inspected headlessly.
import "@blocknote/mantine/style.css";
import "../src/index.css";
import { createRoot } from "react-dom/client";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { cortexSchema } from "../src/components/Shell/schema";

const button = (label: string) => ({ type: "cortexButton", props: { spec: `label: ${label}\naction: url\nurl: https://example.com` } });
const doc: any[] = [
  { type: "heading", props: { level: 2 }, content: "Before" },
  {
    type: "columnList", props: { ratios: "1 2 1" },
    children: [
      { type: "column", props: { width: "1" }, children: [{ type: "heading", props: { level: 2 }, content: "Quick add" }, button("New expense"), button("New income"), { type: "paragraph", content: "left column text" }] },
      { type: "column", props: { width: "2" }, children: [{ type: "heading", props: { level: 2 }, content: "This month" }, { type: "paragraph", content: "middle column, twice as wide" }] },
      { type: "column", props: { width: "1" }, children: [{ type: "heading", props: { level: 2 }, content: "Accounts" }, { type: "paragraph", content: "right column" }] },
    ],
  },
  { type: "paragraph", content: "After" },
];

function App() {
  const editor = useCreateBlockNote({ schema: cortexSchema as any, initialContent: doc as any });
  return <BlockNoteView editor={editor} theme="light" />;
}
createRoot(document.getElementById("root")!).render(<App />);

setTimeout(() => {
  const out = document.getElementById("out")!;
  const list = document.querySelector('[data-content-type="columnList"]');
  const lines: string[] = [];
  if (!list) { out.textContent = "NO columnList content element"; return; }
  let el: Element | null = list;
  const chain: string[] = [];
  while (el && chain.length < 6) { chain.push(`${el.tagName.toLowerCase()}.${Array.from(el.classList).join(".")}`); el = el.parentElement; }
  lines.push("chain up from columnList content: " + chain.join("  <  "));
  const outer = list.closest(".bn-block-outer")!;
  const group = outer.querySelector(":scope > .bn-block > .bn-block-group");
  lines.push("list group display: " + (group ? getComputedStyle(group).display + " / " + getComputedStyle(group).flexDirection : "NO GROUP"));
  group?.querySelectorAll(":scope > .bn-block-outer").forEach((c, i) => {
    const r = (c as HTMLElement).getBoundingClientRect();
    lines.push(`column ${i}: x=${Math.round(r.x)} w=${Math.round(r.width)} flex-grow=${getComputedStyle(c).flexGrow}`);
  });
  document.querySelectorAll('[data-content-type="cortexButton"]').forEach((b, i) => {
    const o = b.closest(".bn-block-outer") as HTMLElement; const r = o.getBoundingClientRect();
    lines.push(`button ${i}: display=${getComputedStyle(o).display} x=${Math.round(r.x)} y=${Math.round(r.y)}`);
  });
  const col0 = group?.querySelector(":scope > .bn-block-outer") as HTMLElement | null;
  if (col0) {
    const r = col0.getBoundingClientRect();
    const px = Math.round(r.x) - 19, py = Math.round(r.y) + 40;
    const hit = document.elementFromPoint(px, py);
    lines.push(`at (${px},${py}): ${hit ? hit.tagName.toLowerCase() + "." + Array.from(hit.classList).join(".") : "nothing"}`);
    for (const target of [col0, col0.querySelector(":scope > .bn-block > .bn-block-group > .bn-block-outer") as HTMLElement]) {
      if (!target) continue;
      const b = getComputedStyle(target, "::before");
      lines.push(`::before of ${Array.from(target.classList).join(".")}: content=${b.content} w=${b.width} border-left=${b.borderLeftWidth} ${b.borderLeftStyle} ${b.borderLeftColor} bg=${b.backgroundColor} outline=${b.outlineWidth} shadow=${b.boxShadow}`);
      const s = getComputedStyle(target);
      lines.push(`  self: border-left=${s.borderLeftWidth} ${s.borderLeftColor} bg=${s.backgroundColor} outline=${s.outlineWidth}`);
    }
  }
  const sel = '.bn-block-outer:has(> .bn-block > .bn-react-node-view-renderer > .bn-block-content[data-content-type="columnList"]) > .bn-block > .bn-block-group';
  try { lines.push(`selector matches: ${document.querySelectorAll(sel).length}`); } catch (e) { lines.push(`selector threw: ${e}`); }
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try { rules = sheet.cssRules; } catch { continue; }
    Array.from(rules ?? []).forEach((r) => { if (r.cssText.includes("columnList")) lines.push("rule: " + r.cssText.slice(0, 160)); });
  }
  out.textContent = lines.join("\n");
  document.title = "HARNESS-READY";
}, 1500);
