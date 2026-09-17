// Line, area and bar charts — one series or several — drawn at the width they
// actually have, so text is never stretched. What a chart is for is reading
// it, so it answers questions without making you estimate:
//   - every bar carries its total on top;
//   - pointing at a segment names it — the category, its amount, its share of
//     the bar — and dims the rest; pointing at a line chart's column lists the
//     values there;
//   - clicking a segment or a legend entry isolates that series (the axis
//     rescales to it), Ctrl/⌘-click adds another, clicking again shows all.
// Nothing here writes anything: the isolation is a way of looking.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChartResult } from "../../lib/commands";
import { compactNumber, fullNumber, niceTicks, orderSeries, sortXs, toggleSelection, xLabel } from "../../lib/chartMath";
import styles from "./XYChart.module.css";

const PALETTE = Array.from({ length: 12 }, (_, i) => `var(--chart-${i + 1})`);

/** The i-th series colour: twelve distinct hues, then the same hues pulled
 *  toward the text colour, so a thirteenth category is not a twin of the first. */
export function seriesColor(i: number): string {
  const base = PALETTE[i % PALETTE.length];
  return i < PALETTE.length ? base : `color-mix(in srgb, ${base} 62%, var(--text-primary))`;
}

const HEIGHT: Record<string, number> = { small: 160, medium: 260, large: 380 };

/** The element's width, following resizes (a dashboard column, a window). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || 640);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width) || 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

interface Tip { x: number; y: number; title: string; lines: { name: string; value: number; color: string; share?: number; on?: boolean }[]; total?: number }

export function XYChart({ chart }: { chart: ChartResult }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [selected, setSelected] = useState<string[]>([]);
  const [hoverSeries, setHoverSeries] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const multi = chart.series.length > 1;
  // One order for stacking, colours and the legend: the biggest first.
  const all = useMemo(
    () => (multi ? orderSeries(chart.series) : [{ name: chart.yLabel || "value", points: chart.points }]),
    [chart, multi],
  );
  const colorOf = useMemo(() => new Map(all.map((s, i) => [s.name, multi ? seriesColor(i) : "var(--accent)"])), [all, multi]);
  const shown = selected.length ? all.filter((s) => selected.includes(s.name)) : all;

  const isBar = chart.chartType === "bar";
  const isArea = chart.chartType === "area";
  const stacked = multi && chart.stack && (isBar || isArea);
  const xs = useMemo(() => sortXs(all.flatMap((s) => s.points.map((p) => p.x))), [all]);
  const byX = useMemo(() => new Map(all.map((s) => [s.name, new Map(s.points.map((p) => [p.x, p.y]))])), [all]);
  const val = (name: string, x: string) => byX.get(name)?.get(x) ?? 0;
  const base = (si: number, x: string) => (stacked ? shown.slice(0, si).reduce((t, s) => t + Math.max(0, val(s.name, x)), 0) : 0);
  const top = (si: number, x: string) => base(si, x) + val(shown[si].name, x);
  const columnTotal = (x: string) => shown.reduce((t, s) => t + val(s.name, x), 0);

  const H = HEIGHT[chart.height] ?? HEIGHT.medium;
  const W = Math.max(240, width);
  const barTotals = isBar && (stacked || !multi);
  const padL = 48, padR = 12, padT = barTotals ? 22 : 12, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  const peaks = stacked ? xs.map(columnTotal) : shown.flatMap((s) => xs.map((x) => val(s.name, x)));
  const ticks = niceTicks(Math.min(0, ...peaks), Math.max(0, ...peaks));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const yAt = (v: number) => padT + innerH - ((v - lo) / (hi - lo || 1)) * innerH;

  const n = xs.length;
  const slot = innerW / Math.max(1, n);
  const xMid = (i: number) => (isBar ? padL + slot * i + slot / 2 : padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW));
  const perSlot = isBar && !stacked ? shown.length : 1;
  const bw = Math.max(2, Math.min(96, (slot * 0.62) / perSlot));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 72))));

  const place = (e: React.MouseEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pick = (name: string, e: React.MouseEvent) => {
    setSelected((cur) => toggleSelection(cur, name, e.ctrlKey || e.metaKey || e.shiftKey));
  };
  const emphasis = hoverSeries;
  const dim = (name: string) => (emphasis && emphasis !== name ? 0.28 : 1);

  const segmentTip = (si: number, x: string, e: React.MouseEvent): Tip => {
    const s = shown[si];
    const total = columnTotal(x);
    // The segment pointed at first, then the rest of the bar biggest first.
    const line = (o: { name: string }) => ({ name: o.name, value: val(o.name, x), color: colorOf.get(o.name)!, share: stacked && total ? val(o.name, x) / total : undefined, on: o.name === s.name });
    const rest = stacked ? shown.filter((o) => o.name !== s.name && val(o.name, x) !== 0).map(line).sort((a, b) => b.value - a.value) : [];
    const lines = [line(s), ...rest];
    return { ...place(e), title: xLabel(x), lines: multi ? lines : [], total };
  };

  const columnTip = (i: number, e: React.MouseEvent): Tip => {
    const x = xs[i];
    const lines = shown.map((s) => ({ name: s.name, value: val(s.name, x), color: colorOf.get(s.name)! }))
      .filter((l) => l.value !== 0).sort((a, b) => b.value - a.value);
    return { ...place(e), title: xLabel(x), lines: multi ? lines : [], total: stacked || !multi ? columnTotal(x) : undefined };
  };

  if (n === 0) return <div className={styles.empty}>No data points yet.</div>;

  return (
    <div className={`${styles.wrap}`} ref={wrapRef} onMouseLeave={() => { setTip(null); setHoverSeries(null); }}>
      <svg className={styles.svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`${chart.yLabel} by ${chart.xLabel}${selected.length ? `, showing ${selected.join(", ")}` : ""}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} className={t === 0 ? styles.zero : styles.grid} />
            <text x={padL - 8} y={yAt(t) + 4} textAnchor="end" className={styles.axis}>{compactNumber(t)}</text>
          </g>
        ))}

        {isBar && shown.map((s, si) => xs.map((x, i) => {
          const y0 = base(si, x), y1 = top(si, x);
          if (y1 === y0) return null;
          const x0 = xMid(i) - (bw * perSlot) / 2 + (stacked ? 0 : si * bw);
          const h = Math.abs(yAt(y0) - yAt(y1));
          return (
            <rect key={`${s.name}|${x}`} x={x0} y={yAt(Math.max(y0, y1))} width={Math.max(1, bw - (perSlot > 1 ? 2 : 0))} height={Math.max(1, h)}
              fill={colorOf.get(s.name)} opacity={dim(s.name)} className={styles.segment}
              onMouseMove={(e) => { setHoverSeries(multi ? s.name : null); setTip(segmentTip(si, x, e)); }}
              onClick={(e) => { if (multi) pick(s.name, e); }} />
          );
        }))}

        {barTotals && xs.map((x, i) => {
          const t = columnTotal(x);
          if (t === 0 || slot < 26) return null;
          return <text key={`t${x}`} x={xMid(i)} y={yAt(Math.max(0, t)) - 6} textAnchor="middle" className={styles.total}>{compactNumber(t)}</text>;
        })}

        {!isBar && shown.map((s, si) => {
          const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${xMid(i)},${yAt(top(si, x))}`).join(" ");
          const color = colorOf.get(s.name);
          return (
            <g key={s.name} opacity={dim(s.name)}>
              {isArea && (
                <path d={`${line} ${[...xs].reverse().map((x, j) => `L${xMid(n - 1 - j)},${yAt(base(si, x))}`).join(" ")} Z`} fill={color} opacity={stacked ? 0.5 : 0.18} />
              )}
              <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {n <= 40 && xs.map((x, i) => <circle key={x} cx={xMid(i)} cy={yAt(top(si, x))} r={2.5} fill={color} />)}
            </g>
          );
        })}

        {/* Line and area: a transparent column per x answers "what is here". */}
        {!isBar && xs.map((x, i) => (
          <rect key={`hit${x}`} x={xMid(i) - (n <= 1 ? innerW : innerW / (n - 1)) / 2} y={padT} width={n <= 1 ? innerW : innerW / (n - 1)} height={innerH}
            fill="transparent" onMouseMove={(e) => setTip(columnTip(i, e))} />
        ))}

        {xs.map((x, i) => i % labelEvery === 0 && (
          <text key={`x${x}`} x={xMid(i)} y={H - 8} textAnchor="middle" className={styles.axis}>{xLabel(x)}</text>
        ))}
      </svg>

      {tip && (
        <div className={styles.tip} style={{ left: Math.min(tip.x + 14, W - 220), top: Math.max(0, tip.y - 12) }}>
          <div className={styles.tipTitle}>
            <span>{tip.title}</span>
            {tip.total !== undefined && <span className={styles.tipTotal}>{fullNumber(tip.total)}</span>}
          </div>
          {tip.lines.slice(0, 8).map((l) => (
            <div key={l.name} className={`${styles.tipLine} ${l.on ? styles.tipOn : ""}`}>
              <span className={styles.swatch} style={{ background: l.color }} />
              <span className={styles.tipName}>{l.name}</span>
              <span className={styles.tipValue}>{fullNumber(l.value)}</span>
              {l.share !== undefined && <span className={styles.tipShare}>{l.share < 0.01 ? "<1%" : `${Math.round(l.share * 100)}%`}</span>}
            </div>
          ))}
          {tip.lines.length > 8 && <div className={styles.tipMore}>+{tip.lines.length - 8} more</div>}
          {multi && isBar && <div className={styles.tipHint}>Click to show only this · Ctrl-click to add</div>}
        </div>
      )}

      {multi && chart.legend && (
        <div className={styles.legend}>
          {all.map((s) => {
            const on = !selected.length || selected.includes(s.name);
            const sum = s.points.reduce((t, p) => t + p.y, 0);
            return (
              <button key={s.name} type="button"
                className={`${styles.legendItem} ${on ? "" : styles.legendOff} ${selected.includes(s.name) ? styles.legendPicked : ""}`}
                title={`${s.name}: ${fullNumber(sum)} — click to show only this, Ctrl-click to add`}
                onMouseEnter={() => setHoverSeries(on ? s.name : null)} onMouseLeave={() => setHoverSeries(null)}
                onClick={(e) => pick(s.name, e)}>
                <span className={styles.swatch} style={{ background: colorOf.get(s.name) }} />
                <span className={styles.legendName}>{s.name}</span>
                <span className={styles.legendSum}>{compactNumber(sum)}</span>
              </button>
            );
          })}
          {selected.length > 0 && (
            <button type="button" className={styles.reset} onClick={() => setSelected([])}>Show all</button>
          )}
        </div>
      )}
      <div className={styles.caption}>
        {chart.yLabel} by {chart.xLabel}
        {selected.length > 0 ? ` · showing ${selected.length} of ${all.length}` : multi ? ` · ${all.length} series` : ` · ${n} point${n === 1 ? "" : "s"}`}
      </div>
    </div>
  );
}
