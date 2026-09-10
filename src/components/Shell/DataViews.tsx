// ── DataViews ─────────────────────────────────────────────────────────────────
// The shared tab engine: a row of named views over one collection, one shown at
// a time, plus add / rename / delete. Used by BOTH the full database page
// (views persist to `_index.md` frontmatter) and the embedded data block (views
// persist to the block's YAML). The parent owns the views array + persistence;
// this component owns which tab is active and renders it.

import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { commands, ViewTable, ChartResult, StatsResult, ViewDef, ViewType } from "../../lib/commands";
import { VIEW_TYPES, defaultViewOfType, viewFromSpec, specFromView } from "../../lib/database";
import {
  DataTable, BoardView, CalendarView, GalleryView, ListView, MiniChart, StatsView, BoardSetup, MissingCollection, missingCollection,
  newRowId, today, seedFromFilter, searchRows,
} from "./CortexViewBlock";
import { ViewToolbar } from "./ViewToolbar";
import { ChartSettings, ChartOptions } from "./ChartSettings";
import { TrackerView, TrackerRange } from "./TrackerView";
import { TimelineView } from "./TimelineView";
import { ErrorBoundary } from "../ErrorBoundary";
import { PlusIcon, TableIcon, BoardIcon, CalendarIcon, GalleryIcon, ListIcon, ChartIcon, StatsIcon, TrackerIcon, TimelineIcon } from "./icons";
import styles from "./DatabaseView.module.css";


export function viewIcon(type: ViewType, size = 14) {
  switch (type) {
    case "board": return <BoardIcon size={size} />;
    case "calendar": return <CalendarIcon size={size} />;
    case "gallery": return <GalleryIcon size={size} />;
    case "list": return <ListIcon size={size} />;
    case "chart": return <ChartIcon size={size} />;
    case "stats": return <StatsIcon size={size} />;
    case "tracker": return <TrackerIcon size={size} />;
    case "timeline": return <TimelineIcon size={size} />;
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
  /** Alt+1…9 pick a view — on for a collection's own page, off for embedded blocks. */
  hotkeys?: boolean;
  /** Drawn after "+ New" at the end of the tab row (the block's own menu). */
  trailing?: ReactNode;
}

export function DataViews({ source, views, onViewsChange, hotkeys, trailing }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  // The active tab's menu is drawn by the bar, not the tab: the tab strip scrolls
  // sideways, and a menu inside a scroller would be cut off.
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [menuLeft, setMenuLeft] = useState(0);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [tabsFade, setTabsFade] = useState(false);
  const measureTabs = useCallback(() => {
    const el = tabsRef.current;
    if (el) setTabsFade(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
  }, []);
  useEffect(() => {
    measureTabs();
    const el = tabsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measureTabs);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureTabs, views]);
  useEffect(() => {
    if (menuFor === null) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || tabsRef.current?.contains(t)) return;
      setMenuFor(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuFor]);
  const toggleMenu = (i: number, el: HTMLElement) => {
    const bar = tabBarRef.current;
    setMenuLeft(bar ? Math.max(0, el.getBoundingClientRect().left - bar.getBoundingClientRect().left) : 0);
    setMenuFor((m) => (m === i ? null : i));
  };
  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || !/^[1-9]$/.test(e.key)) return;
      const i = Number(e.key) - 1;
      if (i < views.length) { e.preventDefault(); setActiveIdx(i); }
    };
    // A button (`action: open` with `view:`) asks the page's views for a tab by name.
    const onSelect = (e: Event) => {
      const name = String((e as CustomEvent).detail?.name ?? "").trim().toLowerCase();
      const i = views.findIndex((v) => v.name.trim().toLowerCase() === name);
      if (i >= 0) setActiveIdx(i);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("cortex:select-view", onSelect);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("cortex:select-view", onSelect); };
  }, [hotkeys, views]);
  const active = views[Math.min(activeIdx, views.length - 1)] ?? views[0];
  const activeSpec = useMemo(() => specFromView(active, source), [active, source]);
  const isChart = active.type === "chart";
  const isTracker = active.type === "tracker";
  const isStats = active.type === "stats";

  // ── data load ──
  const [table, setTable] = useState<ViewTable | null>(null);
  const [chart, setChart] = useState<ChartResult | null>(null);
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The toolbar's search: narrows the rows on show, per view, never written.
  const [search, setSearch] = useState("");
  useEffect(() => { setSearch(""); }, [activeIdx]);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = () => searchRef.current?.focus();
  const shown = useMemo(() => (table ? searchRows(table, search) : null), [table, search]);

  const reload = useCallback(() => {
    // The tracker loads its own data (items + log, computed streaks).
    if (isTracker) { setTable(null); setChart(null); setStats(null); setError(null); return Promise.resolve(); }
    setLoading(true);
    setError(null);
    const p = isChart
      ? commands.runChart(activeSpec).then((c) => { setChart(c); setTable(null); setStats(null); })
      : isStats
        ? commands.runStats(activeSpec).then((s) => { setStats(s); setTable(null); setChart(null); })
        : commands.runView(activeSpec).then((t) => { setTable(t); setChart(null); setStats(null); });
    return p.catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, [activeSpec, isChart, isStats, isTracker]);
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
      <div className={styles.tabBar} ref={tabBarRef}>
        <div className={`${styles.tabs} ${tabsFade ? styles.tabsFade : ""}`} ref={tabsRef} onScroll={measureTabs}>
          {views.map((v, i) => (
            <ViewTab
              key={`${v.name}-${i}`}
              view={v}
              active={i === activeIdx}
              onClick={() => { setMenuFor(null); setActiveIdx(i); }}
              onToggleMenu={(el) => toggleMenu(i, el)}
            />
          ))}
        </div>
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
        <button className={styles.newBtn} onClick={newRow}>+ New</button>
        {trailing}
        {menuFor !== null && views[menuFor] && (
          <div className={styles.tabMenu} style={{ left: menuLeft }} ref={menuRef}>
            <button className={styles.tabMenuItem} onClick={() => { const i = menuFor; setMenuFor(null); renameView(i); }}>Rename</button>
            <button className={styles.tabMenuItem} onClick={() => { const i = menuFor; setMenuFor(null); deleteView(i); }}>Delete view</button>
          </div>
        )}
      </div>

      {isChart ? (
        <ChartConfigBar view={active} onChange={updateActive} />
      ) : isTracker || isStats ? null : (
        <ViewToolbar
          spec={activeSpec}
          fields={table?.allColumns ?? []}
          visibleColumns={table?.columns.map((c) => c.key).filter((k) => k !== "$body") ?? []}
          isBoard={active.type === "board"}
          isTable={active.type === "table"}
          onSpecChange={onSpecChange}
          search={search}
          onSearchChange={setSearch}
          searchRef={searchRef}
        />
      )}

      <div className={styles.content}>
       <ErrorBoundary inline label={`the ${active.name} view`} key={`${activeIdx}:${active.type}`}>
        {error && (missingCollection(error)
          ? <MissingCollection name={missingCollection(error)!} />
          : <div className={styles.error}>{error}</div>)}
        {isTracker ? (
          <TrackerView
            key={active.name}
            spec={activeSpec}
            source={source}
            onRangeChange={(r: TrackerRange) => updateActive({ ...active, range: r })}
            onLogChange={(l) => updateActive({ ...active, log: l })}
          />
        ) : isStats
          ? (stats ? <StatsView stats={stats} /> : loading ? <div className={styles.stub}>Loading…</div> : null)
          : isChart
          ? (chart
              ? (chart.points.length === 0
                  ? <div className={styles.stub}>Set the chart's X and Y fields above.</div>
                  : <MiniChart chart={chart} />)
              : loading ? <div className={styles.stub}>Loading…</div> : null)
          : (table && shown
              ? (search.trim() && shown.rows.length === 0 && active.type !== "calendar"
                  ? <div className={styles.stub}>No rows match “{search.trim()}”.</div>
                  : active.type === "board"
                  ? (active.group
                      ? <BoardView table={shown} spec={activeSpec} source={source} onChanged={reload} />
                      : <BoardSetup table={table} onPick={(f) => updateActive({ ...active, group: f })} />)
                  : active.type === "calendar"
                    ? <CalendarView table={shown} spec={activeSpec} source={source} onChanged={reload} onModeChange={(m) => updateActive({ ...active, mode: m })} />
                    : active.type === "gallery"
                      ? <GalleryView table={shown} spec={activeSpec} source={source} onChanged={reload} />
                      : active.type === "list"
                        ? <ListView table={shown} spec={activeSpec} source={source} onChanged={reload} onFind={focusSearch} />
                      : active.type === "timeline"
                        ? <TimelineView table={shown} spec={activeSpec} source={source} onStartChange={(f) => updateActive({ ...active, start: f })} />
                        : <DataTable table={shown} spec={activeSpec} source={source} onChanged={reload} onSpecChange={onSpecChange} onFind={focusSearch} />)
              : loading ? <div className={styles.stub}>Loading…</div> : null)}
       </ErrorBoundary>
      </div>
    </>
  );
}

function ViewTab({ view, active, onClick, onToggleMenu }: {
  view: ViewDef; active: boolean; onClick: () => void; onToggleMenu: (el: HTMLElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the active tab in view when the strip scrolls (sideways only — never
  // move the page for it).
  useEffect(() => {
    const el = ref.current, strip = el?.parentElement;
    if (!active || !el || !strip) return;
    if (el.offsetLeft < strip.scrollLeft) strip.scrollLeft = el.offsetLeft;
    else if (el.offsetLeft + el.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = el.offsetLeft + el.offsetWidth - strip.clientWidth;
    }
  }, [active]);
  return (
    <div className={`${styles.tab} ${active ? styles.tabActive : ""}`} ref={ref}>
      <button className={styles.tabBtn} onClick={active ? (e) => onToggleMenu(e.currentTarget) : onClick}>
        <span className={styles.tabIcon}>{viewIcon(view.type)}</span>{view.name}
      </button>
    </div>
  );
}

/** A saved chart view's options, through the shared settings panel (the same
 *  panel a chart block in a note shows). */
function ChartConfigBar({ view, onChange }: { view: ViewDef; onChange: (v: ViewDef) => void }) {
  const value: ChartOptions = {
    x: view.x ?? "",
    y: view.y ?? "",
    agg: view.agg ?? "",
    chartType: view.chartType ?? "line",
    bucket: view.bucket ?? "",
    series: view.series ?? "",
    stack: view.stack ?? "",
    labels: view.labels ?? "",
    legend: view.legend ?? "",
    height: view.height ?? "",
  };
  return (
    <ChartSettings
      value={value}
      onChange={(key, v) => onChange({ ...view, [key]: v || undefined })}
    />
  );
}
