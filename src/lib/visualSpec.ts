// The text side of the visual view editors: what they write back into a
// `cortex-view` spec, and the choices they offer instead of syntax. Pure, so
// the round trips are tested without a DOM (visualSpec.test.ts).

/** One tile of a stats view, every value as text — `{label, source?, agg,
 *  field, filter?, format?}` or `{label, expr, format?}`. Keys the editor does
 *  not know are carried through. */
export type StatEntry = Record<string, string>;

/** The key order a stats entry is written in, so diffs stay quiet. */
const STAT_KEY_ORDER = ["label", "source", "agg", "field", "filter", "expr", "format"];

/** A YAML scalar: bare when that reads back as the same string, else a
 *  double-quoted JSON string (valid YAML). */
export function yamlScalar(v: string): string {
  // Words of letters, digits, `_ . / -`, one space apart, the first starting
  // with a letter, `_`, `.` or `/` — nothing YAML reads as syntax or a number.
  const plain = /^[A-Za-z_./][\w./-]*( [\w./][\w./-]*)*$/.test(v)
    && !/^(true|false|yes|no|on|off|null|~)$/i.test(v);
  return plain ? v : JSON.stringify(v);
}

/** Entries → the `stats:` block, one flow map per line. Empty values are
 *  dropped; an empty list writes nothing but the key. */
export function statsBlock(entries: StatEntry[]): string {
  const lines = entries.map((e) => {
    // An empty formula stays `expr: ""`, so a tile just switched to Formula
    // reads back as one; every other empty value is dropped.
    const keys = Object.keys(e).filter((k) => (e[k] ?? "").trim() !== "" || k === "expr")
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return `  - {${keys.map((k) => `${k}: ${yamlScalar(e[k].trim())}`).join(", ")}}`;
  });
  return lines.length ? `stats:\n${lines.join("\n")}` : "stats: []";
}

function rank(k: string): number {
  const i = STAT_KEY_ORDER.indexOf(k);
  return i < 0 ? STAT_KEY_ORDER.length : i;
}

/** Replace a top-level key of a spec — its line and any indented or list
 *  lines under it — with `text` (which starts with `key:`), in place; append
 *  it when the key is absent. */
export function specReplaceKey(spec: string, key: string, text: string): string {
  const lines = spec.split("\n");
  const out: string[] = [];
  let placed = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (new RegExp(`^${key}\\s*:`).test(l)) {
      while (i + 1 < lines.length && /^(\s+\S|-\s)/.test(lines[i + 1])) i++;
      if (!placed) { out.push(text); placed = true; }
      continue;
    }
    out.push(l);
  }
  const body = out.join("\n").replace(/\n+$/, "");
  return (placed ? body : `${body}\n${text}`).replace(/^\n/, "") + "\n";
}

/** The `filter:` line of a serialized spec, "" when it has none. */
export function filterOf(spec: string): string {
  return spec.match(/^filter:\s*(.*)$/m)?.[1]?.trim() ?? "";
}

/** Relative dates a filter can compare a date property with — the `@` words
 *  of `cortex_core::placeholders`, named the way a person asks for them. */
export const DATE_PRESETS: { value: string; label: string }[] = [
  { value: "@today", label: "Today" },
  { value: "@yesterday", label: "Yesterday" },
  { value: "@tomorrow", label: "Tomorrow" },
  { value: "@today-7", label: "A week ago" },
  { value: "@today-30", label: "30 days ago" },
  { value: "@monday", label: "This week (Monday)" },
  { value: "@monday-1", label: "Last week (Monday)" },
  { value: "@month", label: "This month" },
  { value: "@month-1", label: "Last month" },
  { value: "@month+1", label: "Next month" },
  { value: "@quarter", label: "This quarter" },
  { value: "@year", label: "This year" },
  { value: "@year-1", label: "Last year" },
];

/** "@month" → "This month"; a literal date or other text as written. */
export function dateValueLabel(v: string): string {
  return DATE_PRESETS.find((p) => p.value === v)?.label ?? v;
}

/** What a stats tile or a table summary can compute. */
export const AGGREGATES: { value: string; label: string }[] = [
  { value: "count", label: "Count rows" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Smallest" },
  { value: "max", label: "Largest" },
  { value: "percent_checked", label: "Percent checked" },
  { value: "not_empty", label: "Count filled" },
  { value: "empty", label: "Count empty" },
];

/** Number formats a tile can show (`FormattedNumber`). "" = the field's own. */
export const NUMBER_FORMATS: { value: string; label: string }[] = [
  { value: "", label: "As the property" },
  { value: "integer", label: "Whole number" },
  { value: "decimal", label: "Decimal" },
  { value: "currency", label: "Currency" },
  { value: "percent", label: "Percent" },
];

/** A formula after a renamed tile: every name that meant the old tile — its
 *  label as one word, or its underscore form — becomes the new underscore form. */
export function renameInFormula(expr: string, oldLabel: string, newLabel: string): string {
  const next = statIdent(newLabel);
  if (!next) return expr;
  const names = [...new Set([oldLabel.trim(), statIdent(oldLabel)])].filter((n) => /^[\p{L}_][\p{L}\p{N}_]*$/u.test(n));
  let out = expr;
  for (const n of names) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Exact, as the engine looks a tile up; text in quotes is left alone.
    out = out.split(/("[^"]*"|'[^']*')/).map((part, i) => (i % 2 ? part : part.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "gu"), next))).join("");
  }
  return out;
}

/** A formula may name an earlier tile by its label or its underscore form;
 *  the underscore form is what the editor inserts, since it never needs quotes. */
export function statIdent(label: string): string {
  // As `cortex_core::data::stat_ident`: letters, digits and `_` kept, ASCII lowercased.
  const s = [...label.trim()].map((c) => (/[\p{L}\p{N}_]/u.test(c) ? c.replace(/[A-Z]/, (u) => u.toLowerCase()) : "_")).join("");
  return s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}
