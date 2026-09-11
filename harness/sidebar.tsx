// Dev-only harness: the tab that brings the sidebar back, and the motion
// tokens under each setting — the two things the app cannot show without a
// vault and a pointer.
import "../src/styles/tokens.css";
import "../src/index.css";
import { createRoot } from "react-dom/client";
import styles from "../src/components/Shell/Shell.module.css";
import { ChevronRightIcon } from "../src/components/Shell/icons";

function App() {
  return (
    <div style={{ position: "relative", height: 220, background: "var(--bg-app)" }}>
      <button className={styles.sidebarTab} aria-label="Show the sidebar">
        <ChevronRightIcon size={14} />
      </button>
      {/* The hover size, which a headless run cannot produce for itself. */}
      <button className={styles.sidebarTab} style={{ top: "70%", width: 22, opacity: 1 }} aria-label="Show the sidebar (hover)">
        <ChevronRightIcon size={14} />
      </button>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

setTimeout(() => {
  const root = document.documentElement;
  const read = () => {
    const s = getComputedStyle(root);
    return `fast ${s.getPropertyValue("--motion-fast").trim()}, slow ${s.getPropertyValue("--motion-slow").trim()}`;
  };
  const lines = [`animations on:  ${read()}`];
  root.dataset.animations = "off";
  lines.push(`animations off: ${read()}`);
  root.removeAttribute("data-animations");
  lines.push(`back on:        ${read()}`);
  const tab = document.querySelector<HTMLElement>(`.${styles.sidebarTab}`)!;
  const r = tab.getBoundingClientRect();
  lines.push(`tab at rest: ${Math.round(r.width)}x${Math.round(r.height)} at x=${Math.round(r.x)}`);
  document.getElementById("out")!.textContent = lines.join("\n");
  document.title = "HARNESS-READY";
}, 800);
