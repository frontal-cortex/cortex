// Dev-only harness: the repository summary that Settings → Git now carries,
// in both of its states, with the Tauri bridge stubbed.
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback: (cb: unknown) => cb,
  invoke: async (cmd: string) => {
    if (cmd === "git_status") {
      return { staged: [], unstaged: ["notes/ideas/second-brain.md", "collections/budget/coffee.md"], untracked: ["notes/scratch.md"], ahead: 2, behind: 0 };
    }
    if (cmd === "git_log") {
      return [
        { hash: "927d39b1a2c3d4", message: "A tab to bring the sidebar back", author: "you", timestamp: Math.floor(Date.now() / 1000) - 900 },
        { hash: "d611fba9c8d7e6", message: "The sidebar steps aside while you write", author: "you", timestamp: Math.floor(Date.now() / 1000) - 7200 },
        { hash: "8cf43f25b4a3c2", message: "Budget Tracker 3.1: a wishlist the ledger fills in", author: "you", timestamp: Math.floor(Date.now() / 1000) - 90000 },
      ];
    }
    throw new Error(`no stub for ${cmd}`);
  },
};

import "../src/styles/tokens.css";
import "../src/index.css";
import { createRoot } from "react-dom/client";
import { GitSummary } from "../src/components/Shell/GitSummary";

function App() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ fontSize: 12, opacity: 0.6 }}>Settings → Git → Repository</div>
      <GitSummary onCommit={async () => {}} />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
setTimeout(() => { document.title = "HARNESS-READY"; }, 900);
