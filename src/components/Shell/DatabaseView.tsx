// ── DatabaseView ──────────────────────────────────────────────────────────────
// The Notion-style database page: one header + a tab bar of named views over the
// same collection of rows, one shown at a time. Views live in the `_index.md`
// frontmatter (see lib/database.ts); the row data and renderers are reused from
// the embeddable cortex-view block, so a view here behaves identically to one
// embedded in a note.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Picker from "@emoji-mart/react";
import emojiData from "@emoji-mart/data";
import { commands, Note, ViewTable, ChartResult } from "../../lib/commands";
import {
  ViewDef, ViewType, VIEW_TYPES, parseViews, defaultViews, defaultViewOfType,
  viewToFrontmatter, viewFromSpec, specFromView, viewSource,
} from "../../lib/database";
import {
  DataTable, BoardView, CalendarView, GalleryView, MiniChart,
  newRowId, today, seedFromFilter,
} from "./CortexViewBlock";
import { ViewToolbar } from "./ViewToolbar";
import { PlusIcon, TableIcon, BoardIcon, CalendarIcon, GalleryIcon, ChartIcon } from "./icons";
import styles from "./DatabaseView.module.css";

/** SVG glyph for a view type. */
function viewIcon(type: ViewType, size = 14) {
  switch (type) {
    case "board": return <BoardIcon size={size} />;
    case "calendar": return <CalendarIcon size={size} />;
    case "gallery": return <GalleryIcon size={size} />;
    case "chart": return <ChartIcon size={size} />;
    default: return <TableIcon size={size} />;
  }
}

interface Props {
  note: Note;
  collectionName: string;
  onSave: (note: Note) => void;
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

const AGGS = ["", "sum", "avg", "count", "min", "max"];

export function DatabaseView({ note, collectionName, onSave }: Props) {
  const source = viewSource(collectionName);

  const [views, setViews] = useState<ViewDef[]>(() => {
    const v = parseViews(note.frontmatter);
    return v.length ? v : defaultViews();
  });
  const [activeIdx, setActiveIdx] = useState(0);

  // Re-seed when navigating to a different database.
  useEffect(() => {
    const v = parseViews(note.frontmatter);
    setViews(v.length ? v : defaultViews());
    setActiveIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.path]);

  const active = views[Math.min(activeIdx, views.length - 1)] ?? views[0];
  const activeSpec = useMemo(() => specFromView(active, source), [active, source]);
  const isChart = active.type === "chart";

  // ── data load ──
  const [table, setTable] = useState<ViewTable | null>(null);
  const [chart, setChart] = useState<ChartResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    const p = isChart
      ? commands.runChart(activeSpec).then((c) => { setChart(c); setTable(null); })
      : commands.runView(activeSpec).then((t) => { setTable(t); setChart(null); });
    return p.catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, [activeSpec, isChart]);
  useEffect(() => { reload(); }, [reload]);

  // ── persistence ──
  const persistViews = useCallback((next: ViewDef[]) => {
    setViews(next);
    onSave({ ...note, frontmatter: { ...note.frontmatter, type: "database", views: next.map(viewToFrontmatter) } });
  }, [note, onSave]);

  const updateActive = (v: ViewDef) => persistViews(views.map((x, i) => (i === activeIdx ? v : x)));
  const onSpecChange = (nextSpec: string) => updateActive(viewFromSpec(nextSpec, active.name));

  // ── header meta ──
  const title = typeof note.frontmatter["title"] === "string" ? (note.frontmatter["title"] as string) : collectionName;
  const icon = typeof note.frontmatter["icon"] === "string" ? (note.frontmatter["icon"] as string) : "🗃️";
  const setMeta = (patch: Record<string, unknown>) =>
    onSave({ ...note, frontmatter: { ...note.frontmatter, ...patch } });

  const [showEmoji, setShowEmoji] = useState(false);

  // ── new row ──
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
    persistViews(next);
    setActiveIdx(next.length - 1);
    setShowAddView(false);
  };

  const renameView = (i: number) => {
    const name = window.prompt("Rename view", views[i].name)?.trim();
    if (name) persistViews(views.map((v, j) => (j === i ? { ...v, name } : v)));
  };
  const deleteView = (i: number) => {
    if (views.length <= 1) { window.alert("A database needs at least one view."); return; }
    if (!window.confirm(`Delete the "${views[i].name}" view? (rows are not affected)`)) return;
    const next = views.filter((_, j) => j !== i);
    persistViews(next);
    setActiveIdx((cur) => Math.max(0, Math.min(cur, next.length - 1)));
  };

  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        {/* Header */}
        <div className={styles.header}>
          <button className={styles.icon} onClick={() => setShowEmoji((s) => !s)} title="Change icon">{icon}</button>
          <input
            className={styles.title}
            defaultValue={title}
            key={note.path}
            placeholder="Untitled database"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== title) setMeta({ title: v }); }}
          />
        </div>
        {showEmoji && (
          <div className={styles.emojiWrap}>
            <Picker data={emojiData} theme="auto" previewPosition="none" skinTonePosition="none"
              onEmojiSelect={(e: { native: string }) => { setMeta({ icon: e.native }); setShowEmoji(false); }} />
          </div>
        )}

        {/* View tabs */}
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

        {/* Per-view controls */}
        {isChart ? (
          <ChartConfigBar view={active} onChange={updateActive} />
        ) : (
          <ViewToolbar
            spec={activeSpec}
            fields={table?.allColumns ?? []}
            visibleColumns={table?.columns.map((c) => c.key).filter((k) => k !== "$body") ?? []}
            isBoard={active.type === "board"}
            onSpecChange={onSpecChange}
          />
        )}

        {/* Active view. The last-loaded data stays mounted across a refresh
            (add/remove row, drag) — only the very first load shows a stub — so
            mutations update in place instead of flashing the whole view. */}
        <div className={styles.content}>
          {error && <div className={styles.error}>{error}</div>}
          {isChart
            ? (chart
                ? (chart.points.length === 0
                    ? <div className={styles.stub}>No data points — set the chart's X and Y fields.</div>
                    : <MiniChart chart={chart} />)
                : loading ? <div className={styles.stub}>Loading…</div> : null)
            : (table
                ? (active.type === "board"
                    ? <BoardView table={table} spec={activeSpec} source={source} onChanged={reload} />
                    : active.type === "calendar"
                      ? <CalendarView table={table} spec={activeSpec} source={source} onChanged={reload} />
                      : active.type === "gallery"
                        ? <GalleryView table={table} spec={activeSpec} source={source} onChanged={reload} />
                        : <DataTable table={table} spec={activeSpec} source={source} onChanged={reload} />)
                : loading ? <div className={styles.stub}>Loading…</div> : null)}
        </div>
      </div>
    </div>
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

/** Minimal chart configuration (single series). Multi-series is a later step. */
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
        <select className={styles.chartSelect} value={view.agg ?? ""} onChange={(e) => set({ agg: e.target.value || undefined })}>
          {AGGS.map((a) => <option key={a} value={a}>{a || "none"}</option>)}
        </select>
      </label>
      <label className={styles.chartField}>Type
        <select className={styles.chartSelect} value={view.chartType ?? "line"} onChange={(e) => set({ chartType: e.target.value })}>
          <option value="line">line</option>
          <option value="bar">bar</option>
        </select>
      </label>
    </div>
  );
}
