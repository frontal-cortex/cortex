// Dev-only harness: the view toolbar in both of its states, without a vault.
// The toolbar parses its spec through the Rust side, so the Tauri bridge is
// stubbed here with one canned answer — enough to render the controls.
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback: (cb: unknown) => cb,
  invoke: async (cmd: string) => {
    if (cmd === "parse_view_spec") {
      return {
        source: "collections/budget",
        filters: [{ field: "kind", op: "==", value: "expense" }],
        filterJoin: "and",
        filterComplex: false,
        sort: [{ field: "date", dir: "desc" }],
        columns: null,
        group: "date",
        bucket: "month",
      };
    }
    throw new Error(`no stub for ${cmd}`);
  },
};

import "../src/styles/tokens.css";
import "../src/index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ViewToolbar } from "../src/components/Shell/ViewToolbar";

const SPEC = "source: collections/budget\ntype: list\nfilter: kind == 'expense'\n";
const FIELDS = ["title", "date", "amount", "kind", "category", "account"];

function App() {
  const [search, setSearch] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>the view toolbar</div>
        <ViewToolbar
          spec={SPEC} fields={FIELDS} visibleColumns={FIELDS} isBoard={false} isTable
          onSpecChange={() => {}} search={search} onSearchChange={setSearch}
        />
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
setTimeout(() => { document.title = "HARNESS-READY"; }, 1200);
