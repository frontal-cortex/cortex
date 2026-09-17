// How a stored date reads in a view: "16 Sep" rather than "2026-09-16" (with
// the year when the date is in another one).
// Display only — the file keeps the ISO date, and editing still opens the
// date picker on it. Pure, so it is tested without a DOM (displayDate.test.ts).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-09-16` → "16 Sep" this year, "16 Sep 2025" in any other;
 *  `2026-09-16T08:30` → "16 Sep, 08:30". Anything else comes back unchanged.
 *  `thisYear` is passed in by the tests; it is the current year otherwise. */
export function friendlyDate(text: string, thisYear = new Date().getFullYear()): string {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return text;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return text;
  // The year is what a reader already knows: it goes unless the date is in another one.
  const year = Number(m[1]) === thisYear ? "" : ` ${m[1]}`;
  const day = `${Number(m[3])} ${month}${year}`;
  return m[4] ? `${day}, ${m[4]}:${m[5]}` : day;
}

/** A date or a `{start, end}` range as it reads: "14 Sep 2026 → 21 Sep 2026". */
export function friendlyDateValue(v: unknown): string | null {
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? friendlyDate(v) : null;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const r = v as { start?: unknown; end?: unknown };
    if (typeof r.start !== "string") return null;
    const start = friendlyDate(r.start);
    return typeof r.end === "string" && r.end && r.end !== r.start ? `${start} → ${friendlyDate(r.end)}` : start;
  }
  return null;
}
