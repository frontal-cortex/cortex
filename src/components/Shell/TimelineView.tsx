// ── Timeline view ─────────────────────────────────────────────────────────────
// One row per item, a bar from its start date to its end date on a horizontal
// week axis: a roadmap, a set of trips, a project's milestones. The data is the
// same `run_view` table the table and board use; only the field mapping is the
// view's — `start:` and `end:` (default `start` / `end`, else the first two
// date columns; with one date column every item is a one-day bar). Items with
// no start sit under "Unscheduled". Read-only in this pass: click a bar to open
// the row, j/k to move, Enter to open, t to scroll to today. Drag the axis to
// pan (mouse, pen or finger — one pointer path), pinch or Ctrl+wheel to zoom;
// `-` / `=` zoom from the keyboard.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ViewTable, ViewColumn } from "../../lib/commands";
import { DRAG_THRESHOLD_PX, Point, clamp, distance, pinchFactor, wheelZoomFactor, zoomAnchored } from "../../lib/gestures";
import { TimelineIcon } from "./icons";
import styles from "./TimelineView.module.css";

/** Pixels per day at the default zoom, and the zoom's bounds. */
const DAY_PX = 18;
const MIN_DAY_PX = 4;
const MAX_DAY_PX = 60;
const MIN_WEEKS = 8;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
/** Whole days from a to b (both local midnights). */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
/** The Monday on or before d. */
function mondayOf(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}
/** A cell's date as YYYY-MM-DD, or null when it is not a date. */
function dateOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function peek(spec: string, key: string): string | undefined {
  return spec.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
}

/** The start/end fields: the spec's, else `start`/`end`, else the date columns. */
export function timelineFields(table: ViewTable, spec: string): { start: string | null; end: string | null } {
  const has = (k: string | undefined) => !!k && table.columns.some((c) => c.key === k);
  const dateCols = table.columns.filter((c) => c.ty === "date" && c.key !== "$body").map((c) => c.key);
  const declaredStart = peek(spec, "start");
  const declaredEnd = peek(spec, "end");
  const start = has(declaredStart) ? declaredStart! : has("start") ? "start" : dateCols[0] ?? null;
  const rest = dateCols.filter((k) => k !== start);
  const end = has(declaredEnd) ? declaredEnd! : has("end") && "end" !== start ? "end" : rest[0] ?? null;
  return { start, end };
}

/** Ask the app shell to open a collection row as a full note. */
function openRow(source: string, rowId: string) {
  if (!source.startsWith("collections/")) return;
  const path = `${source.replace(/\/$/, "")}/${rowId}.md`;
  window.dispatchEvent(new CustomEvent("cortex:open-note", { detail: { path } }));
}

interface Item {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  color: string | null;
}

interface Props {
  table: ViewTable;
  spec: string;
  source: string;
  /** Persist a chosen start field when the view has no date to draw from. */
  onStartChange?: (field: string) => void;
}

export function TimelineView({ table, spec, source, onStartChange }: Props) {
  const { start: startField, end: endField } = timelineFields(table, spec);
  const canOpen = source.startsWith("collections/");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [dayPx, setDayPx] = useState(DAY_PX);
  const WEEK_PX = dayPx * 7;

  // Bar colour: the first select/status property's option colour for the row.
  const colorCol: ViewColumn | undefined = table.columns.find((c) => c.schema?.type === "select" || c.schema?.type === "status");

  const { scheduled, unscheduled, axisStart, weeks, todayIdx } = useMemo(() => {
    const items: Item[] = table.rows.map((row) => {
      const s = startField ? dateOf(row.cells[startField]) : null;
      let e = endField ? dateOf(row.cells[endField]) : null;
      if (s && (!e || e < s)) e = s;
      const val = colorCol ? String(row.cells[colorCol.key] ?? "") : "";
      const color = colorCol?.schema?.options?.find((o) => o.name === val)?.color ?? null;
      return { id: row.id, title: String(row.cells["title"] ?? row.id), start: s, end: e, color };
    });
    const scheduled = items.filter((i) => i.start).sort((a, b) => a.start!.localeCompare(b.start!));
    const unscheduled = items.filter((i) => !i.start);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // The axis covers every bar and today, padded a week each side, Monday-aligned.
    let lo = today, hi = today;
    for (const i of scheduled) {
      const s = parseYmd(i.start!), e = parseYmd(i.end!);
      if (s < lo) lo = s;
      if (e > hi) hi = e;
    }
    const axisStart = mondayOf(addDays(lo, -7));
    const weeks = Math.max(MIN_WEEKS, Math.ceil((daysBetween(axisStart, addDays(hi, 7)) + 1) / 7));
    return { scheduled, unscheduled, axisStart, weeks, todayIdx: daysBetween(axisStart, today) };
  }, [table.rows, startField, endField, colorCol]);

  const width = weeks * WEEK_PX;
  const xOf = (day: string) => daysBetween(axisStart, parseYmd(day)) * dayPx;

  const scrollToToday = () => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, todayIdx * dayPx - el.clientWidth / 3);
  };
  // Open on today, and again only when the axis itself moves — a reload with
  // the same span keeps the user's scroll position.
  const axisKey = axisStart.getTime();
  useEffect(() => { scrollToToday(); }, [axisKey]); // scrollToToday reads refs and todayIdx, which move with axisKey

  // ── Zoom + pan ──────────────────────────────────────────────────────────────
  // The day under the pointer (or between the fingers) stays put while the
  // scale changes: the scroll position is corrected in the same frame.
  const labelW = () => {
    const el = scrollRef.current;
    return el ? parseFloat(getComputedStyle(el).getPropertyValue("--label-w")) || 0 : 0;
  };
  // The corrected scroll position lands after the render that resizes the
  // axis — set before it, a zoom-in would be clamped to the old width.
  const pendingScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingScroll.current == null || !scrollRef.current) return;
    scrollRef.current.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
  }, [dayPx]);
  const zoomAt = (factor: number, clientX: number) => {
    const el = scrollRef.current;
    const next = clamp(dayPx * factor, MIN_DAY_PX, MAX_DAY_PX);
    if (next === dayPx) return;
    if (el) {
      const offset = clientX - el.getBoundingClientRect().left - labelW();
      pendingScroll.current = zoomAnchored(el.scrollLeft, offset, next / dayPx);
    }
    setDayPx(next);
  };
  const zoomCentred = (factor: number) => {
    const el = scrollRef.current;
    zoomAt(factor, el ? el.getBoundingClientRect().left + labelW() + (el.clientWidth - labelW()) / 2 : 0);
  };
  // Ctrl / Cmd + wheel zooms; a plain wheel keeps scrolling. Attached by hand
  // because React registers `wheel` as passive, so `onWheel` could not
  // stop the browser zooming the page too.
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAtRef.current(wheelZoomFactor(e.deltaY), e.clientX);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [startField]);

  // Pointer drag pans the axis (one pointer) or pinches the zoom (two).
  // `touch-action: pan-y` on the scroller leaves vertical page scrolling to
  // the browser and hands sideways moves and pinches to us. A press that
  // moved is a pan, so the click that follows must not open a row.
  const pointers = useRef(new Map<number, Point>());
  const pan = useRef<{ x: number; scrollLeft: number; dist: number; dayPx: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget;
    suppressClick.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture(e.pointerId);
    const pts = [...pointers.current.values()];
    pan.current = {
      x: pts.length >= 2 ? (pts[0].x + pts[1].x) / 2 : e.clientX,
      scrollLeft: el.scrollLeft,
      dist: pts.length >= 2 ? distance(pts[0], pts[1]) : 0,
      dayPx,
      moved: pan.current?.moved ?? false,
    };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = e.currentTarget;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const factor = pinchFactor(p.dist, distance(pts[0], pts[1]));
      const next = clamp(p.dayPx * factor, MIN_DAY_PX, MAX_DAY_PX);
      const mid = (pts[0].x + pts[1].x) / 2;
      const offset = p.x - el.getBoundingClientRect().left - labelW();
      const target = zoomAnchored(p.scrollLeft, offset, next / p.dayPx) - (mid - p.x);
      if (next !== dayPx) { pendingScroll.current = target; setDayPx(next); } else el.scrollLeft = target;
      p.moved = true;
      return;
    }
    const dx = e.clientX - p.x;
    if (Math.abs(dx) >= DRAG_THRESHOLD_PX) p.moved = true;
    if (p.moved) el.scrollLeft = p.scrollLeft - dx;
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      // Down to one finger: pan on from where it stands.
      const [pt] = pointers.current.values();
      pan.current = { x: pt.x, scrollLeft: e.currentTarget.scrollLeft, dist: 0, dayPx, moved: true };
      return;
    }
    if (pan.current?.moved) suppressClick.current = true;
    pan.current = null;
  };
  /** The click that ends a pan is not a click on the bar it ended over. */
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  const all = [...scheduled, ...unscheduled];
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (all.length === 0) return;
    const cur = focus ?? -1;
    switch (e.key) {
      case "j": case "ArrowDown": e.preventDefault(); setFocus(Math.min(all.length - 1, cur + 1)); return;
      case "k": case "ArrowUp": e.preventDefault(); setFocus(Math.max(0, cur - 1)); return;
      case "Enter": if (cur >= 0 && canOpen) { e.preventDefault(); openRow(source, all[cur].id); } return;
      case "t": e.preventDefault(); scrollToToday(); return;
      case "-": e.preventDefault(); zoomCentred(1 / 1.25); return;
      case "=": case "+": e.preventDefault(); zoomCentred(1.25); return;
      case "Escape": setFocus(null); e.currentTarget.blur(); return;
    }
  };

  if (!startField) {
    return <TimelineSetup table={table} onPick={(f) => onStartChange?.(f)} />;
  }

  const barStyle = (it: Item): React.CSSProperties | undefined =>
    it.color ? { "--bar-bg": `var(--tag-${it.color}-bg)`, "--bar-fg": `var(--tag-${it.color}-fg)` } as React.CSSProperties : undefined;

  const row = (it: Item, idx: number) => (
    <div
      key={it.id}
      className={`${styles.row} ${focus === idx ? styles.rowFocus : ""}`}
      onMouseEnter={() => setFocus(idx)}
    >
      <div
        className={`${styles.label} ${canOpen ? styles.labelOpen : ""}`}
        title={it.title}
        onClick={canOpen ? () => openRow(source, it.id) : undefined}
      >
        {it.title}
      </div>
      <div className={styles.lane} style={{ width }}>
        {it.start && (
          <button
            type="button"
            className={`${styles.bar} ${it.start === it.end ? styles.barDay : ""}`}
            style={{ ...barStyle(it), left: xOf(it.start), width: Math.max(dayPx, (daysBetween(parseYmd(it.start), parseYmd(it.end!)) + 1) * dayPx) }}
            title={it.start === it.end ? `${it.title} · ${it.start}` : `${it.title} · ${it.start} → ${it.end}`}
            onClick={canOpen ? () => openRow(source, it.id) : undefined}
            tabIndex={-1}
          >
            <span className={styles.barText}>{it.title}</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div
      className={styles.root}
      tabIndex={0}
      onKeyDown={onKey}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocus(null); }}
      aria-label="Timeline — j k to move, Enter to open, t for today, - = to zoom"
    >
      <div
        className={styles.scroll}
        ref={scrollRef}
        style={{ "--week-px": `${WEEK_PX}px` } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        <div className={styles.body} style={{ width: `calc(var(--label-w) + ${width}px)` }}>
          <div className={styles.header}>
            <div className={`${styles.label} ${styles.headerLabel}`}>
              {startField}{endField && endField !== startField ? ` → ${endField}` : ""}
            </div>
            <div className={styles.lane} style={{ width }}>
              {Array.from({ length: weeks }, (_, w) => {
                const d = addDays(axisStart, w * 7);
                return (
                  <span key={w} className={styles.week} style={{ left: w * WEEK_PX, width: WEEK_PX }}>
                    {d.getDate()} {MON[d.getMonth()]}
                  </span>
                );
              })}
            </div>
          </div>
          {scheduled.map((it, i) => row(it, i))}
          {unscheduled.length > 0 && (
            <div className={styles.section}>
              <div className={`${styles.label} ${styles.sectionLabel}`}>Unscheduled</div>
            </div>
          )}
          {unscheduled.map((it, i) => row(it, scheduled.length + i))}
          {todayIdx >= 0 && todayIdx < weeks * 7 && (
            <div className={styles.today} style={{ left: `calc(var(--label-w) + ${todayIdx * dayPx + dayPx / 2}px)` }} title={ymd(new Date())} />
          )}
        </div>
      </div>
      {scheduled.length === 0 && unscheduled.length === 0 && (
        <div className={styles.stub}>Nothing here yet — add a row with a {startField} date.</div>
      )}
    </div>
  );
}

// ── Setup: no date to draw from ───────────────────────────────────────────────

function TimelineSetup({ table, onPick }: { table: ViewTable; onPick: (field: string) => void }) {
  const fields = table.columns.filter((c) => c.key !== "$body" && c.key !== "id" && c.key !== "title");
  return (
    <div className={styles.setup}>
      <TimelineIcon size={22} />
      <div className={styles.setupTitle}>Which property is the start date?</div>
      <div className={styles.setupHint}>
        A timeline draws each row as a bar from a <code>start</code> date to an <code>end</code> date. Pick the property holding the start, or add a date property first.
      </div>
      {fields.length > 0 && (
        <div className={styles.setupChips}>
          {fields.map((c) => <button key={c.key} className={styles.setupChip} onClick={() => onPick(c.key)}>{c.key}</button>)}
        </div>
      )}
    </div>
  );
}
