// Dev-only harness: the tracker in its three layouts with a stubbed backend,
// to check that item titles render as titles (not default buttons) and open
// their row when clicked.
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const TODAY = Date.UTC(2026, 8, 14);

function result(range: string) {
  const n = range === "today" ? 1 : range === "week" ? 7 : range === "month" ? 30 : 364;
  const start = TODAY - (n - 1) * DAY;
  const days = Array.from({ length: n }, (_, i) => ({ date: iso(start + i * DAY), done: 1, expected: 3, perfect: false, logId: null }));
  const item = (id: string, title: string, icon: string | null, seed: number) => ({
    id, title, icon, color: null, frequency: "daily", target: 7,
    cells: days.map((_, i) => (i === n - 1 ? "pending" : (i * seed) % 3 === 0 ? "missed" : "done")),
    currentStreak: 2, longestStreak: 5, streakUnit: "days", weekDone: 3,
  });
  return {
    range, anchor: iso(TODAY), start: days[0].date, end: days[n - 1].date, today: iso(TODAY),
    logSource: "collections/habit-log", dateField: "date", doneField: "done",
    items: [item("read", "Read 20 pages", "📖", 1), item("untitled", "Untitled", null, 2), item("stretch", "Stretch", "🧘", 5)],
    days,
  };
}

const opened: string[] = [];
window.addEventListener("cortex:open-note", (e) => opened.push((e as CustomEvent<{ path: string }>).detail.path));

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback: (cb: unknown) => cb,
  invoke: async (cmd: string, args: { spec?: string }) => {
    if (cmd === "run_tracker") return result(/range:\s*(\w+)/.exec(args.spec ?? "")?.[1] ?? "week");
    if (cmd === "list_collections") return [];
    throw new Error(`no stub for ${cmd}`);
  },
};

import "../src/styles/tokens.css";
import "../src/index.css";
import { createRoot } from "react-dom/client";
import { TrackerView } from "../src/components/Shell/TrackerView";

const spec = (range: string) => `source: collections/habits\ntype: tracker\nrange: ${range}\nlog: collections/habit-log\n`;

function App() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, background: "var(--bg-app)", color: "var(--text-primary)", padding: 12 }}>
      {["today", "week", "year"].map((r) => (
        <div key={r}>
          <div style={{ fontSize: 11, opacity: 0.6 }}>{r}</div>
          <TrackerView spec={spec(r)} source="collections/habits" onRangeChange={() => {}} onLogChange={() => {}} />
        </div>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

setTimeout(() => {
  const links = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter((b) => /titleLink/.test(b.className));
  const lines = [`title links: ${links.length}`];
  if (links[0]) {
    const s = getComputedStyle(links[0]);
    lines.push(`first link: "${links[0].textContent}" bg=${s.backgroundColor} border=${s.borderTopWidth} font-size=${s.fontSize} weight=${s.fontWeight}`);
  }
  const untitled = links.find((b) => b.textContent === "Untitled");
  untitled?.click();
  lines.push(`clicking Untitled opened: ${opened.join(", ") || "nothing"}`);
  document.getElementById("out")!.textContent = lines.join("\n");
  document.title = "HARNESS-READY";
}, 1200);
