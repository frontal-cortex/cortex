// Dev-only harness: the chart settings panel on its own, in both states, so
// its layout can be checked headlessly without a vault behind it.
import "../src/styles/tokens.css";
import "../src/index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChartSettings, ChartSettingsPanel, ChartOptions } from "../src/components/Shell/ChartSettings";

const donut: ChartOptions = {
  x: "category", y: "amount", agg: "sum", chartType: "donut",
  bucket: "", series: "", stack: "", labels: "name_value", legend: "false", height: "",
};

function App() {
  const [value, setValue] = useState<ChartOptions>(donut);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <div>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>closed (a configured chart)</div>
        <ChartSettings value={value} onChange={(k, v) => setValue({ ...value, [k]: v })} />
      </div>
      <div>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>the panel</div>
        <div style={{ position: "relative", height: 400 }}>
          <ChartSettingsPanel value={value} onChange={(k, v) => setValue({ ...value, [k]: v })} />
        </div>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
setTimeout(() => { document.title = "HARNESS-READY"; }, 1200);
