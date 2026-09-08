// ── DataViews ─────────────────────────────────────────────────────────────────
// The shared tab engine: a row of named views over one collection, one shown at
// a time, plus add / rename / delete. Used by BOTH the full database page
// (views persist to `_index.md` frontmatter) and the embedded data block (views
// persist to the block's YAML). The parent owns the views array + persistence;
// this component owns which tab is active and renders it.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { commands, ViewTable, ChartResult, ViewDef, ViewType } from "../../lib/commands";
import { VIEW_TYPES, defaultViewOfType, viewFromSpec, specFromView } from "../../lib/database";
import {
  DataTable, BoardView, CalendarView, GalleryView, MiniChart, BoardSetup,
  newRowId, today, seedFromFilter,
} from "./CortexViewBlock";
import { ViewToolbar } from "./ViewToolbar";
import { TrackerView, TrackerRange } from "./TrackerView";
import { Dropdown } from "./Dropdown";
import { PlusIcon, TableIcon, BoardIcon, CalendarIcon, GalleryIcon, ChartIcon, TrackerIcon } from "./icons";
import styles from "./DatabaseView.module.css";

const AGGS = ["", "sum", "avg", "count", "min", "max"];
const BUCKETS = ["", "day", "week", "month", "year"];

export function viewIcon(type: ViewType, size = 14) {
  switch (type) {
    case "board": return <BoardIcon size={size} />;
    case "calendar": return <CalendarIcon size={size} />;
    case "gallery": return <GalleryIcon size={size} />;
    case "chart": return <ChartIcon size={size} />;
    case "tracker": return <TrackerIcon size={size} />;
    default: return <TableIcon size={size} />;
  }
}

function useOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return ref;
}

interface Props {
  source: string;
  views: ViewDef[];
  onViewsChange: (views: ViewDef[]) => void;
}

export function DataViews({ source, views, onViewsChange }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const active = views[Math.min(activeIdx, views.length - 1)] ?? views[0];
  const activeSpec = useMemo(() => specFromView(active, source), [active, source]);
  const isChart = active.type === "chart";
  const isTracker = active.type === "tracker";

  // ── data load ──
  const [table, setTable] = useState<ViewTable | null>(null);
  const [chart, setChart] = useState<ChartResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    // The tracker loads its own data (items + log, computed streaks).
    if (isTracker) { setTable(null); setChart(null); setError(null); return Promise.resolve(); }
    setLoading(true);
    setError(null);
    const p = isChart
      ? commands.runChart(activeSpec).then((c) => { setChart(c); setTable(null); })
      : commands.runView(activeSpec).then((t) => { setTable(t); setChart(null); });
    return p.catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, [activeSpec, isChart, isTracker]);
  useEffect(() => { reload(); }, [reload]);

  // Re-run when a sync pulls teammate changes.
  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener("cortex:data-changed", onChanged);
    return () => window.removeEventListener("cortex:data-changed", onChanged);
  }, [reload]);

  // ── persistence ──
  const updateActive = (v: ViewDef) => onViewsChange(views.map((x, i) => (i === activeIdx ? v : x)));
  const onSpecChange = (nextSpec: string) => updateActive(viewFromSpec(nextSpec, active.name));

  const newRow = () =>
    commands.addRow(source, newRowId(), { title: "Untitled", created: today(), ...seedFromFilter(activeSpec) })
      .then(reload).catch((e) => setError(String(e)));

  // ── view CRUD ──
  const [showAddView, setShowAddView] = useState(false);
  const addViewRef = useOutside(() => setShowAddView(false));

  const addView = (type: ViewType) => {
    const label = VIEW_TYPES.find((t) => t.type === type)!.label;
    const taken = new Set(views.map((v) => v.name));
    let name = label, n = 2;
    while (taken.has(name)) name = `${label} ${n++}`;
    const next = [...views, defaultViewOfType(type, name)];
    onViewsChange(next);
    setActiveIdx(next.length - 1);
    setShowAddView(false);
  };

  const renameView = (i: number) => {
    const name = window.prompt("Rename view", views[i].name)?.trim();
    if (name) onViewsChange(views.map((v, j) => (j === i ? { ...v, name } : v)));
  };
  const deleteView = (i: number) => {
    if (views.length <= 1) { window.alert("Keep at least one view."); return; }
    if (!window.confirm(`Delete the "${views[i].name}" view? (rows are not affected)`)) return;
    onViewsChange(views.filter((_, j) => j !== i));
    setActiveIdx((cur) => Math.max(0, Math.min(cur, views.length - 2)));
  };

  return (
    <>
      <div className={styles.tabBar}>
        <div className={styles.tabs}>
          {views.map((v, i) => (
            <ViewTab
              key={`${v.name}-${i}`}
              view={v}
              active={i === activeIdx}
              onClick={() => setActiveIdx(i)}
              onRename={() => renameView(i)}
              onDelete={() => deleteView(i)}
            />
          ))}
          <div className={styles.addView} ref={addViewRef}>
            <button className={styles.addBtn} title="Add view" onClick={() => setShowAddView((s) => !s)}>
              <PlusIcon size={14} />
            </button>
            {showAddView && (
              <div className={styles.addMenu}>
                {VIEW_TYPES.map((t) => (
                  <button key={t.type} className={styles.addItem} onClick={() => addView(t.type)}>
                    <span className={styles.addIcon}>{viewIcon(t.type, 15)}</span> {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <button className={styles.newBtn} onClick={newRow}>+ New</button>
      </div>

      {isChart ? (
        <ChartConfigBar view={active} onChange={updateActive} />
      ) : isTracker ? null : (
        <ViewToolbar
          spec={activeSpec}
          fields={table?.allColumns ?? []}
          visibleColumns={table?.columns.map((c) => c.key).filter((k) => k !== "$body") ?? []}
          isBoard={active.type === "board"}
          onSpecChange={onSpecChange}
        />
      )}

      <div className={styles.content}>
        {error && <div className={styles.error}>{error}</div>}
        {isTracker ? (
          <TrackerView
            key={active.name}
            spec={activeSpec}
            source={source}
            onRangeChange={(r: TrackerRange) => updateActive({ ...active, range: r })}
            onLogChange={(l) => updateActive({ ...active, log: l })}
          />
        ) : isChart
          ? (chart
              ? (chart.points.length === 0
                  ? <div className={styles.stub}>Set the chart's X and Y fields above.</div>
                  : <MiniChart chart={chart} />)
              : loading ? <div className={styles.stub}>Loading…</div> : null)
          : (table
              ? (active.type === "board"
                  ? (active.group
                      ? <BoardView table={table} spec={activeSpec} source={source} onChanged={reload} />
                      : <BoardSetup table={table} onPick={(f) => updateActive({ ...active, group: f })} />)
                  : active.type === "calendar"
                    ? <CalendarView table={table} spec={activeSpec} source={source} onChanged={reload} />
                    : active.type === "gallery"
                      ? <GalleryView table={table} spec={activeSpec} source={source} onChanged={reload} />
                      : <DataTable table={table} spec={activeSpec} source={source} onChanged={reload} />)
              : loading ? <div className={styles.stub}>Loading…</div> : null)}
      </div>
    </>
  );
}

function ViewTab({ view, active, onClick, onRename, onDelete }: {
  view: ViewDef; active: boolean; onClick: () => void; onRename: () => void; onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useOutside(() => setMenu(false));
  return (
    <div className={`${styles.tab} ${active ? styles.tabActive : ""}`} ref={ref}>
      <button className={styles.tabBtn} onClick={active ? () => setMenu((m) => !m) : onClick}>
        <span className={styles.tabIcon}>{viewIcon(view.type)}</span>{view.name}
      </button>
      {menu && active && (
        <div className={styles.tabMenu}>
          <button className={styles.tabMenuItem} onClick={() => { setMenu(false); onRename(); }}>Rename</button>
          <button className={styles.tabMenuItem} onClick={() => { setMenu(false); onDelete(); }}>Delete view</button>
        </div>
      )}
    </div>
  );
}

/** Minimal single-series chart configuration. */
function ChartConfigBar({ view, onChange }: { view: ViewDef; onChange: (v: ViewDef) => void }) {
  const set = (patch: Partial<ViewDef>) => onChange({ ...view, ...patch });
  return (
    <div className={styles.chartBar}>
      <label className={styles.chartField}>X
        <input className={styles.chartInput} value={view.x ?? ""} placeholder="date field"
          onChange={(e) => set({ x: e.target.value })} />
      </label>
      <label className={styles.chartField}>Y
        <input className={styles.chartInput} value={view.y ?? ""} placeholder="number field"
          onChange={(e) => set({ y: e.target.value })} />
      </label>
      <label className={styles.chartField}>Aggregate
        <Dropdown
          value={view.agg ?? ""}
          options={AGGS.map((a) => ({ value: a, label: a || "none" }))}
          onChange={(v) => set({ agg: v || undefined })}
        />
      </label>
      <label className={styles.chartField}>Type
        <Dropdown
          value={view.chartType ?? "line"}
          options={[{ value: "line", label: "line" }, { value: "bar", label: "bar" }]}
          onChange={(v) => set({ chartType: v })}
        />
      </label>
      <label className={styles.chartField}>By
        <Dropdown
          value={view.bucket ?? ""}
          options={BUCKETS.map((b) => ({ value: b, label: b || "exact x" }))}
          onChange={(v) => set({ bucket: v || undefined })}
        />
      </label>
      <label className={styles.chartField}>Series
        <input className={styles.chartInput} value={view.series ?? ""} placeholder="field (one line each)"
          onChange={(e) => set({ series: e.target.value || undefined })} />
      </label>
    </div>
  );
}
