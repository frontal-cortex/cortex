// Dev-only harness: one list row at dashboard-column widths, to check what a
// row gives up when there is not enough space — the title should keep its
// characters and the property chips should be cut off instead.
import "../src/styles/tokens.css";
import "../src/index.css";
import { createRoot } from "react-dom/client";
import styles from "../src/components/Shell/CortexViewBlock.module.css";

const CHIPS = [["amount", "82.40"], ["account", "checking"], ["payee", "Supermarket"]];

function Row() {
  return (
    <div className={styles.listRow}>
      <span className={styles.listTitle}>Weekly shop, last week (example)</span>
      <span className={styles.listChips}>
        {CHIPS.map(([k, v]) => (
          <span key={k} className={styles.listChip}>
            <span className={styles.listChipKey}>{k}</span>{v}
          </span>
        ))}
      </span>
    </div>
  );
}

const WIDTHS = [186, 300, 560];

function App() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: 16 }}>
      {WIDTHS.map((w) => (
        <div key={w} style={{ width: w }}>
          <div style={{ fontSize: 11, opacity: 0.6 }}>{w}px</div>
          <div className={styles.card}><div className={styles.list}><Row /></div></div>
        </div>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

setTimeout(() => {
  const lines: string[] = [];
  document.querySelectorAll(`.${styles.listRow}`).forEach((row, i) => {
    const title = row.querySelector(`.${styles.listTitle}`) as HTMLElement;
    const chips = row.querySelector(`.${styles.listChips}`) as HTMLElement;
    lines.push(
      `${WIDTHS[i]}px: title ${Math.round(title.getBoundingClientRect().width)}px ` +
      `(needs ${title.scrollWidth}px, ${title.scrollWidth > title.clientWidth + 1 ? "CUT" : "whole"}), ` +
      `chips ${Math.round(chips.getBoundingClientRect().width)}px of ${chips.scrollWidth}px`,
    );
  });
  document.getElementById("out")!.textContent = lines.join("\n");
  document.title = "HARNESS-READY";
}, 900);
