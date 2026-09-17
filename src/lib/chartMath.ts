// The numbers behind an x/y chart, kept apart from the drawing so they are
// tested without a DOM (chartMath.test.ts): round axis ticks, short value
// labels, readable x labels, and the order series stack and take colours in.

/** Ticks from 0 (or a negative minimum) to past the maximum on a 1/2/5 × 10ⁿ
 *  step, so the axis reads 0 · 2,000 · 4,000 · 6,000 · 8,000, never 7,512.1. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  const lo = Math.min(0, min);
  const hi = max > lo ? max : lo + 1;
  const raw = (hi - lo) / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v < hi + step * 0.999; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

/** A value short enough to sit on top of a bar: 950, 1.2k, 12k, 3.4M. */
export function compactNumber(n: number): string {
  if (!isFinite(n)) return "—";
  const a = Math.abs(n);
  const trim = (s: string) => s.replace(/\.0$/, "");
  if (a >= 1e6) return `${trim((n / 1e6).toFixed(a >= 1e7 ? 0 : 1))}M`;
  if (a >= 1e4) return `${trim((n / 1e3).toFixed(0))}k`;
  if (a >= 1e3) return `${trim((n / 1e3).toFixed(1))}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(a >= 100 ? 0 : 1);
}

/** A value in full for a tooltip: 1,549.09. */
export function fullNumber(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** An x value as a person reads it: a bucketed month `2026-07` is "Jul 2026",
 *  a quarter `2026-Q3` stays, a day `2026-07-14` is "14 Jul". */
export function xLabel(x: string): string {
  const month = x.match(/^(\d{4})-(\d{2})$/);
  if (month) return `${MONTHS[Number(month[2]) - 1] ?? month[2]} ${month[1]}`;
  const day = x.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return `${Number(day[3])} ${MONTHS[Number(day[2]) - 1] ?? day[2]}`;
  return x;
}

/** x values in order: numbers numerically, everything else as text (ISO dates sort as text). */
export function sortXs(xs: string[]): string[] {
  return [...new Set(xs)].sort((a, b) => {
    const [p, q] = [Number(a), Number(b)];
    return a.trim() !== "" && b.trim() !== "" && !isNaN(p) && !isNaN(q) ? p - q : a.localeCompare(b);
  });
}

export interface Series { name: string; points: { x: string; y: number }[] }

/** Series biggest first: the largest sits at the bottom of a stack and takes
 *  the first, most distinct colour; ties keep their names in order. */
export function orderSeries<S extends Series>(series: S[]): S[] {
  const total = (s: S) => s.points.reduce((t, p) => t + Math.max(0, p.y), 0);
  return [...series].sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name));
}

/** Toggle one series in a selection. A plain click shows only that series (or
 *  everything again when it was already the only one); with `add`, it joins or
 *  leaves the selection. An empty selection means every series. */
export function toggleSelection(selected: string[], name: string, add: boolean): string[] {
  if (add) return selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name];
  return selected.length === 1 && selected[0] === name ? [] : [name];
}
