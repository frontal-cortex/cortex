// ── Tracker view ──────────────────────────────────────────────────────────────
// Items × days with a mark per cell: a habit tracker, a watering schedule, a
// medication log. The items are the view's collection; the days live in a
// second collection (`log:`) with one row per day whose `done:` list names the
// items ticked. Everything shown — streaks, day scores, the heatmap — is
// computed by the backend on read; the only write is a toggle, which edits one
// day's list (creating the day's file from the log's row template on the first
// tick). A missing day is a day with nothing done, so today always exists.
//
// Four ranges: Today (a checklist), Week (habits × Mon–Sun), Month (habits ×
// days), Year (a heatmap of day scores plus a per-habit year strip). The grid
// is a roving keyboard surface: j/k or arrows move between habits, h/l between
// days, Space or Enter toggles, t jumps to today, [ and ] step the range,
// 1–9 tick the n-th habit today.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commands, TrackerResult, TrackerItem, TrackerCell } from "../../lib/commands";
import { ChevronLeftIcon, ChevronRightIcon, CheckIcon, TrackerIcon } from "./icons";
import styles from "./TrackerView.module.css";

export type TrackerRange = "today" | "week" | "month" | "year";
const RANGES: { id: TrackerRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function specGet(spec: string, key: string): string | undefined {
  return spec.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function addMonths(s: string, n: number): string {
  const d = parseYmd(s);
  return ymd(new Date(d.getFullYear(), d.getMonth() + n, 1));
}
function stepAnchor(range: TrackerRange, anchor: string, dir: 1 | -1): string {
  switch (range) {
    case "today": return addDays(anchor, dir);
    case "week": return addDays(anchor, 7 * dir);
    case "month": return addMonths(anchor, dir);
    case "year": return addDays(anchor, 364 * dir);
  }
}

/** "Tue 8 Sep", "8 – 14 Sep 2026", "September 2026", "Sep 2025 – Sep 2026". */
function rangeLabel(r: TrackerResult): string {
  const s = parseYmd(r.start), e = parseYmd(r.end);
  const day = (d: Date) => `${d.getDate()} ${MON[d.getMonth()]}`;
  switch (r.range) {
    case "today": return `${DOW[(s.getDay() + 6) % 7]} ${day(s)} ${s.getFullYear()}`;
    case "week": return s.getMonth() === e.getMonth()
      ? `${s.getDate()} – ${e.getDate()} ${MON[e.getMonth()]} ${e.getFullYear()}`
      : `${day(s)} – ${day(e)} ${e.getFullYear()}`;
    case "month": return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][s.getMonth()]} ${s.getFullYear()}`;
    default: return `${MON[s.getMonth()]} ${s.getFullYear()} – ${MON[e.getMonth()]} ${e.getFullYear()}`;
  }
}

function streakLabel(it: TrackerItem): string {
  const unit = it.streakUnit === "weeks" ? "week" : "day";
  if (it.currentStreak === 0) return it.longestStreak > 0 ? `best ${it.longestStreak} ${unit}${it.longestStreak === 1 ? "" : "s"}` : "";
  return `${it.currentStreak}-${unit} streak`;
}

/** A cell can be toggled when its day is not in the future. */
function toggleable(cell: TrackerCell): boolean {
  return cell !== "future";
}

const itemColor = (it: TrackerItem) => (it.color ? { "--mark": `var(--tag-${it.color}-fg)` } as React.CSSProperties : undefined);

interface Props {
  spec: string;
  source: string;
  /** Persist a changed range into the view (the tab or the block spec). */
  onRangeChange?: (range: TrackerRange) => void;
  /** Persist a chosen log collection when the view has none yet. */
  onLogChange?: (log: string) => void;
  /** Files were written — parents that keep their own data can refresh. */
  onChanged?: () => void;
  /** Compact: no header chrome (the palette's Log habit list, a daily note). */
  compact?: boolean;
}

export function TrackerView({ spec, source, onRangeChange, onLogChange, onChanged, compact }: Props) {
  const specRange = (specGet(spec, "range") as TrackerRange | undefined) ?? "week";
  const log = specGet(spec, "log");
  const [range, setRange] = useState<TrackerRange>(specRange);
  useEffect(() => { setRange(specRange); }, [specRange]);
  const [anchor, setAnchor] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<TrackerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ row: number; col: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const runSpec = useMemo(() => {
    // The range the user picked wins over the spec's until it is persisted.
    const lines = spec.split("\n").filter((l) => !/^range:/.test(l) && l.trim() !== "");
    return [...lines, `range: ${range}`].join("\n") + "\n";
  }, [spec, range]);

  const reload = useCallback(() => {
    if (!log) { setResult(null); return Promise.resolve(); }
    return commands.runTracker(runSpec, anchor)
      .then((r) => { setResult(r); setError(null); })
      .catch((e) => setError(String(e)));
  }, [runSpec, anchor, log]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const h = () => reload();
    window.addEventListener("cortex:data-changed", h);
    return () => window.removeEventListener("cortex:data-changed", h);
  }, [reload]);

  const pickRange = (r: TrackerRange) => { setRange(r); setFocus(null); onRangeChange?.(r); };
  const step = (dir: 1 | -1) => { if (result) setAnchor(stepAnchor(range, result.anchor, dir)); };
  const goToday = () => setAnchor(undefined);

  const toggle = useCallback((it: TrackerItem, dayIdx: number) => {
    if (!result) return;
    const day = result.days[dayIdx];
    if (!day || !toggleable(it.cells[dayIdx])) return;
    const key = `${it.id}:${day.date}`;
    const wasDone = it.cells[dayIdx] === "done";
    // Optimistic mark; streaks and scores follow from the reload.
    setResult((r) => r && ({
      ...r,
      items: r.items.map((x) => x.id === it.id
        ? { ...x, cells: x.cells.map((c, i) => (i === dayIdx ? (wasDone ? (day.date === r.today ? "pending" : "missed") : "done") : c)) }
        : x),
    }));
    setBusy(key);
    commands.trackerToggle(result.logSource, result.dateField, result.doneField, day.date, it.title, !wasDone)
      .then(() => { onChanged?.(); return reload(); })
      .catch((e) => { setError(String(e)); reload(); })
      .finally(() => setBusy(null));
  }, [result, reload, onChanged]);

  // ── keyboard ──
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!result || result.items.length === 0) return;
    const rows = result.items.length;
    const cols = range === "year" ? 1 : result.days.length;
    const todayIdx = Math.max(0, result.days.findIndex((d) => d.date === result.today));
    const cur = focus ?? { row: 0, col: range === "year" ? 0 : todayIdx };
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      setFocus({ row: Math.min(rows - 1, Math.max(0, cur.row + dr)), col: Math.min(cols - 1, Math.max(0, cur.col + dc)) });
    };
    switch (e.key) {
      case "j": case "ArrowDown": return move(1, 0);
      case "k": case "ArrowUp": return move(-1, 0);
      case "l": case "ArrowRight": return move(0, 1);
      case "h": case "ArrowLeft": return move(0, -1);
      case " ": case "Enter":
        e.preventDefault();
        if (range !== "year") { setFocus(cur); toggle(result.items[cur.row], cur.col); }
        return;
      case "t": e.preventDefault(); goToday(); return;
      case "[": e.preventDefault(); step(-1); return;
      case "]": e.preventDefault(); step(1); return;
      case "Escape": setFocus(null); (e.currentTarget as HTMLDivElement).blur(); return;
      default:
        if (/^[1-9]$/.test(e.key) && range !== "year") {
          const n = Number(e.key) - 1;
          if (n < rows && todayIdx >= 0) { e.preventDefault(); toggle(result.items[n], todayIdx); }
        }
    }
  };

  if (!log) {
    return <LogSetup source={source} onPick={(l) => onLogChange?.(l)} />;
  }
  if (error) return <div className={styles.error}>{error}</div>;
  if (!result) return <div className={styles.stub}>Loading…</div>;

  const todayIdx = result.days.findIndex((d) => d.date === result.today);
  const todayDay = todayIdx >= 0 ? result.days[todayIdx] : null;
  const rangeDone = result.days.reduce((n, d) => n + d.done, 0);
  const rangeExpected = result.days.filter((d) => d.date <= result.today).reduce((n, d) => n + d.expected, 0);
  const pct = rangeExpected > 0 ? Math.round((100 * rangeDone) / rangeExpected) : 0;

  return (
    <div className={`${styles.root} ${compact ? styles.compact : ""}`}>
      {!compact && (
        <div className={styles.bar}>
          <div className={styles.ranges} role="tablist">
            {RANGES.map((r) => (
              <button key={r.id} role="tab" aria-selected={range === r.id}
                className={`${styles.rangeBtn} ${range === r.id ? styles.rangeOn : ""}`} onClick={() => pickRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <div className={styles.nav}>
            <button className={styles.navBtn} onClick={() => step(-1)} title="Earlier ([)"><ChevronLeftIcon size={13} /></button>
            <span className={styles.navLabel}>{rangeLabel(result)}</span>
            <button className={styles.navBtn} onClick={() => step(1)} title="Later (])"><ChevronRightIcon size={13} /></button>
            {anchor && <button className={styles.todayBtn} onClick={goToday} title="Back to today (t)">Today</button>}
          </div>
          <div className={styles.summary}>
            {range === "today" && todayDay ? (
              todayDay.expected === 0 ? <span>Nothing due today</span>
                : todayDay.perfect ? <span className={styles.perfect}><CheckIcon size={12} /> Perfect day</span>
                : <span>{todayDay.done} of {todayDay.expected} today</span>
            ) : (
              <span>{rangeDone} of {rangeExpected} · {pct}%</span>
            )}
            <span className={styles.meter}><span className={styles.meterFill} style={{ width: `${range === "today" && todayDay && todayDay.expected > 0 ? Math.round((100 * todayDay.done) / todayDay.expected) : pct}%` }} /></span>
          </div>
        </div>
      )}

      {result.items.length === 0 ? (
        <div className={styles.stub}>No items yet — add a row to {source.replace(/^collections\//, "")} and it appears here.</div>
      ) : (
        <div
          ref={gridRef}
          className={styles.grid}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocus(null); }}
          aria-label="Tracker grid — j k h l to move, Space to toggle"
        >
          {range === "today" && <TodayList r={result} todayIdx={todayIdx} focus={focus} busy={busy} onToggle={toggle} onFocus={setFocus} />}
          {(range === "week" || range === "month") && <DayGrid r={result} range={range} focus={focus} busy={busy} onToggle={toggle} onFocus={setFocus} />}
          {range === "year" && <YearView r={result} focus={focus} onFocus={setFocus} />}
        </div>
      )}
    </div>
  );
}

// ── Today: a checklist ────────────────────────────────────────────────────────

function TodayList({ r, todayIdx, focus, busy, onToggle, onFocus }: {
  r: TrackerResult; todayIdx: number; focus: { row: number; col: number } | null; busy: string | null;
  onToggle: (it: TrackerItem, dayIdx: number) => void; onFocus: (f: { row: number; col: number }) => void;
}) {
  const dayIdx = todayIdx >= 0 ? todayIdx : 0;
  const day = r.days[dayIdx];
  return (
    <ul className={styles.todayList}>
      {r.items.map((it, row) => {
        const cell = it.cells[dayIdx];
        const done = cell === "done";
        const off = cell === "off" || cell === "future";
        return (
          <li key={it.id}
            className={`${styles.todayRow} ${done ? styles.todayDone : ""} ${off ? styles.todayOff : ""} ${focus?.row === row ? styles.rowFocus : ""}`}
            style={itemColor(it)}
            onMouseEnter={() => onFocus({ row, col: dayIdx })}
          >
            <button
              className={`${styles.check} ${done ? styles.checkOn : ""}`}
              disabled={!toggleable(cell) || busy === `${it.id}:${day?.date}`}
              onClick={() => onToggle(it, dayIdx)}
              title={done ? "Done — click to undo" : off ? "Not scheduled today — click to log it anyway" : `Mark ${it.title} done (${row + 1})`}
              aria-pressed={done}
            >
              {done && <CheckIcon size={13} />}
            </button>
            <span className={styles.todayIcon}>{it.icon ?? ""}</span>
            <span className={styles.todayTitle}>{it.title}</span>
            <span className={styles.todayMeta}>
              {it.streakUnit === "weeks" && <span className={styles.weekly}>{it.weekDone}/{it.target} this week</span>}
              {streakLabel(it) && <span className={it.currentStreak > 0 ? styles.streak : styles.streakBest}>{streakLabel(it)}</span>}
              {row < 9 && <kbd className={styles.kbd}>{row + 1}</kbd>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ── Week / month: habits × days ──────────────────────────────────────────────

function DayGrid({ r, range, focus, busy, onToggle, onFocus }: {
  r: TrackerResult; range: "week" | "month"; focus: { row: number; col: number } | null; busy: string | null;
  onToggle: (it: TrackerItem, dayIdx: number) => void; onFocus: (f: { row: number; col: number }) => void;
}) {
  const month = range === "month";
  return (
    <div className={`${styles.tableWrap} ${month ? styles.month : styles.week}`}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.thItem} />
            {r.days.map((d) => {
              const dt = parseYmd(d.date);
              const isToday = d.date === r.today;
              return (
                <th key={d.date} className={`${styles.thDay} ${isToday ? styles.today : ""} ${d.date > r.today ? styles.future : ""}`}>
                  {!month && <span className={styles.dow}>{DOW[(dt.getDay() + 6) % 7]}</span>}
                  <span className={styles.dom}>{dt.getDate()}</span>
                </th>
              );
            })}
            <th className={styles.thStat}>streak</th>
            {!month && <th className={styles.thStat}>week</th>}
          </tr>
        </thead>
        <tbody>
          {r.items.map((it, row) => (
            <tr key={it.id} className={focus?.row === row ? styles.rowFocus : ""} style={itemColor(it)}>
              <td className={styles.tdItem}>
                <span className={styles.itemIcon}>{it.icon ?? ""}</span>
                <span className={styles.itemTitle}>{it.title}</span>
              </td>
              {it.cells.map((cell, col) => {
                const d = r.days[col];
                const isFocus = focus?.row === row && focus?.col === col;
                return (
                  <td key={d.date} className={`${styles.tdDay} ${d.date === r.today ? styles.today : ""}`}>
                    <button
                      className={`${styles.mark} ${styles[`mark_${cell}`]} ${isFocus ? styles.markFocus : ""}`}
                      disabled={!toggleable(cell) || busy === `${it.id}:${d.date}`}
                      onClick={() => { onFocus({ row, col }); onToggle(it, col); }}
                      onMouseEnter={() => onFocus({ row, col })}
                      title={`${it.title} · ${d.date}${cell === "done" ? " · done" : cell === "missed" ? " · missed" : cell === "off" ? " · not scheduled" : ""}`}
                      aria-pressed={cell === "done"}
                    >
                      {cell === "done" && <CheckIcon size={month ? 9 : 12} />}
                    </button>
                  </td>
                );
              })}
              <td className={styles.tdStat}>
                {it.currentStreak > 0
                  ? <span className={styles.streak}>{it.currentStreak}{it.streakUnit === "weeks" ? "w" : "d"}</span>
                  : <span className={styles.streakBest}>{it.longestStreak > 0 ? `best ${it.longestStreak}` : "—"}</span>}
              </td>
              {!month && (
                <td className={styles.tdStat}>
                  <span className={it.weekDone >= it.target ? styles.weekMet : styles.weekly}>{it.weekDone}/{it.target}</span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className={styles.tdFootLabel}>done</td>
            {r.days.map((d) => (
              <td key={d.date} className={`${styles.tdFoot} ${d.date === r.today ? styles.today : ""}`}>
                {d.date <= r.today && d.expected > 0 && (
                  <span className={`${styles.dayScore} ${d.perfect ? styles.dayPerfect : ""}`} title={`${d.done} of ${d.expected}`}>
                    {month ? (d.perfect ? "●" : d.done > 0 ? "◐" : "○") : `${d.done}/${d.expected}`}
                  </span>
                )}
              </td>
            ))}
            <td className={styles.tdStat} />
            {!month && <td className={styles.tdStat} />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Year: a heatmap of day scores, then a strip per habit ────────────────────

function YearView({ r, focus, onFocus }: { r: TrackerResult; focus: { row: number; col: number } | null; onFocus: (f: { row: number; col: number }) => void }) {
  // Columns are weeks (Mon–Sun), rows weekdays — the range starts on a Monday.
  const weeks = Math.ceil(r.days.length / 7);
  const level = (done: number, expected: number) => expected === 0 ? 0 : Math.min(4, Math.ceil((4 * done) / expected));
  const monthLabels: { col: number; label: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    const d = r.days[w * 7];
    if (!d) break;
    const dt = parseYmd(d.date);
    if (dt.getDate() <= 7) monthLabels.push({ col: w, label: MON[dt.getMonth()] });
  }
  return (
    <div className={styles.year}>
      <div className={styles.heatWrap}>
        <div className={styles.heatMonths} style={{ gridTemplateColumns: `repeat(${weeks}, var(--cell))` }}>
          {monthLabels.map((m) => <span key={m.col} style={{ gridColumnStart: m.col + 1 }}>{m.label}</span>)}
        </div>
        <div className={styles.heat} style={{ gridTemplateColumns: `repeat(${weeks}, var(--cell))` }}>
          {r.days.map((d, i) => {
            const past = d.date <= r.today;
            const lv = past ? level(d.done, d.expected) : -1;
            return (
              <span
                key={d.date}
                className={`${styles.heatCell} ${lv >= 0 ? styles[`heat${lv}`] : styles.heatFuture} ${d.date === r.today ? styles.heatToday : ""}`}
                style={{ gridColumn: Math.floor(i / 7) + 1, gridRow: (i % 7) + 1 }}
                title={`${d.date}: ${d.done} of ${d.expected}${d.perfect ? " — perfect" : ""}`}
              />
            );
          })}
        </div>
      </div>
      <ul className={styles.yearList}>
        {r.items.map((it, row) => {
          const cols: { done: number; days: number }[] = [];
          for (let w = 0; w < weeks; w++) {
            const slice = it.cells.slice(w * 7, w * 7 + 7);
            cols.push({ done: slice.filter((c) => c === "done").length, days: slice.filter((c) => c === "done" || c === "missed" || c === "free" || c === "pending").length });
          }
          return (
            <li key={it.id} className={`${styles.yearRow} ${focus?.row === row ? styles.rowFocus : ""}`} style={itemColor(it)} onMouseEnter={() => onFocus({ row, col: 0 })}>
              <span className={styles.itemIcon}>{it.icon ?? ""}</span>
              <span className={styles.itemTitle}>{it.title}</span>
              <span className={styles.strip} style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
                {cols.map((c, w) => (
                  <span key={w} className={styles.stripCell} style={{ opacity: c.days === 0 ? 0.12 : 0.18 + 0.82 * Math.min(1, c.done / Math.max(1, Math.min(it.target, 7))) }} title={`week of ${r.days[w * 7]?.date}: ${c.done} done`} />
                ))}
              </span>
              <span className={styles.yearStats}>
                <span className={styles.rate}>{it.rangeExpected > 0 ? `${Math.round((100 * it.rangeDone) / it.rangeExpected)}%` : "—"}</span>
                <span className={it.currentStreak > 0 ? styles.streak : styles.streakBest}>
                  {it.currentStreak > 0 ? `${it.currentStreak}${it.streakUnit === "weeks" ? "w" : "d"}` : ""}{it.longestStreak > 0 ? ` · best ${it.longestStreak}` : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Setup: pick the log collection ───────────────────────────────────────────

function LogSetup({ source, onPick }: { source: string; onPick: (log: string) => void }) {
  const [collections, setCollections] = useState<string[]>([]);
  useEffect(() => { commands.listCollections().then(setCollections).catch(() => {}); }, []);
  const mine = source.replace(/^collections\//, "");
  const others = collections.filter((c) => c !== mine);
  return (
    <div className={styles.setup}>
      <TrackerIcon size={22} />
      <div className={styles.setupTitle}>Which collection holds the days?</div>
      <div className={styles.setupHint}>
        A tracker ticks the rows of <strong>{mine}</strong> against a log: one row per day with a <code>date</code> and a <code>done</code> list naming what was completed.
      </div>
      {others.length === 0
        ? <div className={styles.setupHint}>Create a collection for the log first (for example <code>{mine}-log</code>).</div>
        : <div className={styles.setupChips}>{others.map((c) => <button key={c} className={styles.setupChip} onClick={() => onPick(`collections/${c}`)}>{c}</button>)}</div>}
    </div>
  );
}
