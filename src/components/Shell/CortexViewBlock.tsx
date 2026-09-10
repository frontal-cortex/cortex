// ── Embeddable data-view block ────────────────────────────────────────────────
// A `cortex-view` / `cortex-chart` fenced code block renders as a live table /
// board / chart inside the editor. On disk it is ALWAYS a standard fenced code
// block (human-readable, git-diffable) — the custom block exists only in memory.
//
// Storage uses the DEFAULT code block (lossless Markdown round-trip via
// blocksToMarkdownLossy / tryParseMarkdownToBlocks). We translate
// codeBlock(language: "cortex-view") <-> our custom block at the load/save
// boundary, so we never depend on BlockNote's lossy custom-block serializer.

import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, ReactNode } from "react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { createReactBlockSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { commands, ViewTable, ViewColumn, ViewGroup, PropType, PropertyDef, ChartResult, Stat, StatsResult } from "../../lib/commands";
import { CloseIcon, OpenIcon, TableIcon, BoardIcon, CalendarIcon, GalleryIcon, ListIcon, ChartIcon, StatsIcon, TrackerIcon, TimelineIcon, CheckIcon } from "./icons";
import { SelectCell } from "./SelectCell";
import { TrackerView } from "./TrackerView";
import { TimelineView } from "./TimelineView";
import { Dropdown } from "./Dropdown";
import { DatePicker } from "./DatePicker";
import { isMac, tableKeysHint } from "../../lib/keymap";
import { ViewToolbar } from "./ViewToolbar";
import { useViewport } from "../../hooks/useViewport";
import { dragSource, useDropTarget } from "../../hooks/usePointerDrag";
import { DateRangeInput, FilesInput, Ring, formatRange, rangeOf, rangeEnd } from "./PropertyInputs";
import { DEFAULT_STATS } from "../../lib/database";
import styles from "./CortexViewBlock.module.css";

/** Select-like columns render as colored pills (incl. person + relation). The
 *  reverse side of a relation (`from:`) is computed on read, so it is not one. */
function isSelectColumn(col: ViewColumn): boolean {
  const t = col.schema?.type;
  return t === "select" || t === "status" || t === "multi_select" || t === "person" || (t === "relation" && !col.schema?.from);
}

/** Rollups, formulas, reverse relations and the git-derived properties
 *  (created / edited time and by): computed by the engine, read-only here. */
function isComputedColumn(col: ViewColumn): boolean {
  const t = col.schema?.type;
  return t === "rollup" || t === "formula" || (t === "relation" && !!col.schema?.from) || isAuthorshipType(t);
}

function isAuthorshipType(t: PropType | undefined): boolean {
  return t === "created_time" || t === "created_by" || t === "edited_time" || t === "edited_by";
}

/** A date-range column: declared as one, or inferred from `{start, end}` values. */
function isRangeColumn(col: ViewColumn): boolean {
  return col.schema?.type === "date_range" || (!col.schema && col.ty === "date_range");
}

const AUTHORSHIP_LABELS: Record<string, string> = {
  created_time: "Created time · from git history",
  created_by: "Created by · from git history",
  edited_time: "Last edited time · from git history",
  edited_by: "Last edited by · from git history",
};

/** Columns whose values are numbers and can carry a display format. */
function isNumericColumn(col: ViewColumn): boolean {
  const t = col.schema?.type;
  return t === "number" || t === "rollup" || t === "formula" || (!t && col.ty === "number");
}

/** Schema key for a source — its collection name, or null for CSV sources. */
function collectionKey(source: string): string | null {
  const m = source.match(/^collections\/([^/]+)/);
  return m ? m[1] : null;
}

const COLUMN_TYPES: { value: PropType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
  { value: "select", label: "Select" },
  { value: "status", label: "Status" },
  { value: "multi_select", label: "Multi-select" },
  { value: "person", label: "Person" },
  { value: "url", label: "URL" },
  { value: "date_range", label: "Date range" },
  { value: "files", label: "Files" },
  { value: "created_time", label: "Created time" },
  { value: "created_by", label: "Created by" },
  { value: "edited_time", label: "Last edited time" },
  { value: "edited_by", label: "Last edited by" },
];

/** Column header with a Notion-style "property type" menu. Setting a select-like
 *  type creates the schema property, which turns the cells into colored pills.
 *  Rename and delete go through the engine, which rewrites every row, the
 *  views and any rollup or formula that names the property. */
function ColumnHeader({ col, canType, onSetType, onSetFormat, onRename, onDelete }: {
  col: ViewColumn;
  canType: boolean;
  onSetType: (type: PropType) => void;
  onSetFormat: (patch: Partial<PropertyDef>) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fmtOpen, setFmtOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  useEffect(() => { if (!open) { setRenaming(false); setFmtOpen(false); } }, [open]);

  const commitRename = (raw: string) => {
    const name = raw.trim();
    setRenaming(false);
    if (name && name !== col.key) { onRename(name); setOpen(false); }
  };

  if (!canType) return <span>{col.key}</span>;

  const current = col.schema?.type;
  const computed = isComputedColumn(col);
  const numeric = isNumericColumn(col);
  const format = col.schema?.format ?? "";
  const computedLabel = col.schema?.type === "formula"
    ? `Formula · ${col.schema.expr ?? ""}`
    : isAuthorshipType(col.schema?.type)
      ? AUTHORSHIP_LABELS[col.schema!.type]
    : col.schema?.type === "rollup"
      ? `Rollup · ${col.schema.function ?? "count"}${col.schema.from ? ` from ${col.schema.from}` : ` via ${col.schema.relation ?? ""}`}`
      : `Rows of ${col.schema?.from ?? ""} linking here`;
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); };
  return (
    <div className={styles.colHeader} ref={ref}>
      <button className={styles.colHeaderBtn} onClick={() => setOpen((o) => !o)} title={computed ? computedLabel : "Property type"}>
        {col.key}
      </button>
      {open && (
        <div className={styles.colMenu}>
          {computed && !isAuthorshipType(current) ? (
            <div className={styles.colMenuLabel}>{computedLabel}</div>
          ) : (
            <>
              <div className={styles.colMenuLabel}>Property type</div>
              {COLUMN_TYPES.map((t) => (
                <button
                  key={t.value}
                  className={styles.colMenuItem}
                  onClick={() => { onSetType(t.value); setOpen(false); }}
                >
                  {t.label}{current === t.value ? " ✓" : ""}
                </button>
              ))}
            </>
          )}
          {numeric && (
            <>
              <div className={styles.colMenuSep} />
              <button className={styles.colMenuItem} onClick={() => setFmtOpen((o) => !o)}>
                Format… <span className={styles.colMenuHint}>{NUMBER_FORMATS.find((f) => f.value === format)?.label ?? format}</span>
              </button>
              {fmtOpen && (
                <div className={styles.colSub}>
                  {NUMBER_FORMATS.map((f) => (
                    <button key={f.value} className={styles.colMenuItem} onClick={() => onSetFormat({ format: f.value || undefined })}>
                      {f.label}{format === f.value ? " ✓" : ""}
                    </button>
                  ))}
                  {(format === "currency" || format === "progress") && (
                    <label className={styles.colSubRow}>Unit
                      <input className={styles.colSubInput} defaultValue={col.schema?.unit ?? ""} placeholder={format === "currency" ? "€" : "kg"}
                        onBlur={(e) => onSetFormat({ unit: e.target.value.trim() || undefined })} onKeyDown={blurOnEnter} />
                    </label>
                  )}
                  {format === "progress" && (
                    <label className={styles.colSubRow}>Min
                      <input className={styles.colSubInput} type="number" defaultValue={col.schema?.min ?? ""} placeholder="0"
                        onBlur={(e) => onSetFormat({ min: e.target.value === "" ? undefined : Number(e.target.value) })} onKeyDown={blurOnEnter} />
                    </label>
                  )}
                  {(format === "progress" || format === "stars") && (
                    <label className={styles.colSubRow}>Max
                      <input className={styles.colSubInput} type="number" defaultValue={col.schema?.max ?? ""} placeholder={format === "stars" ? "5" : "100"}
                        onBlur={(e) => onSetFormat({ max: e.target.value === "" ? undefined : Number(e.target.value) })} onKeyDown={blurOnEnter} />
                    </label>
                  )}
                </div>
              )}
            </>
          )}
          <div className={styles.colMenuSep} />
          <button className={styles.colMenuItem} onClick={() => setRenaming((r) => !r)}>Rename…</button>
          {renaming && (
            <div className={styles.colSub}>
              <input
                className={styles.colSubInput}
                autoFocus
                defaultValue={col.key}
                placeholder="New name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename((e.target as HTMLInputElement).value);
                  if (e.key === "Escape") setRenaming(false);
                }}
                onBlur={(e) => commitRename(e.target.value)}
              />
            </div>
          )}
          <button className={`${styles.colMenuItem} ${styles.colMenuDanger}`} onClick={() => { setOpen(false); onDelete(); }}>
            Delete property
          </button>
        </div>
      )}
    </div>
  );
}

/** "+" column header → a small form to add a new typed property to the schema. */
// Relation/rollup/formula need extra config the column-header retype menu can't
// provide, so they're only offered when *adding* a property.
const ADD_PROP_TYPES: { value: PropType; label: string }[] = [
  ...COLUMN_TYPES,
  { value: "relation", label: "Relation" },
  { value: "rollup", label: "Rollup" },
  { value: "formula", label: "Formula" },
];
const ROLLUP_FNS = ["count", "sum", "avg", "min", "max", "values"];
/** `percent` is the share of the reverse rows matching `where`; it only makes sense from the reverse side. */
const REVERSE_ROLLUP_FNS = ["count", "percent", "sum", "avg", "min", "max", "values"];
const FORMULA_HINT = "+ - * / %, comparisons, and or not · days_until, days_since, days_between, today, year, month, round, abs, min, max, if, coalesce, len, contains, concat, lower, upper, empty";

function AddPropertyHeader({ columns, onAdd }: { columns: ViewColumn[]; onAdd: (prop: PropertyDef) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<PropType>("text");
  const [collection, setCollection] = useState("");
  // Rollup source: "rel:<column>" follows one of this collection's relations;
  // "from:<collection>" collects the rows over there that point back here.
  const [via, setVia] = useState("");
  const [relation, setRelation] = useState("");
  const [property, setProperty] = useState("");
  const [fn, setFn] = useState("count");
  const [where, setWhere] = useState("");
  const [expr, setExpr] = useState("");
  const [collections, setCollections] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    commands.listCollections().then(setCollections).catch(() => {});
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const relationCols = columns.filter((c) => c.schema?.type === "relation" && !c.schema.from);
  const reverse = via.startsWith("from:");
  const fns = reverse ? REVERSE_ROLLUP_FNS : ROLLUP_FNS;
  const viaOptions = [
    ...relationCols.map((c) => ({ value: `rel:${c.key}`, label: `via ${c.key}` })),
    ...collections.map((c, i) => ({ value: `from:${c}`, label: `from ${c}`, hint: "rows that link here", separator: i === 0 && relationCols.length > 0 })),
  ];

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    if (type === "relation" && !collection) return;
    if (type === "rollup" && (!via || !fn || (reverse && !relation.trim()))) return;
    if (type === "formula" && !expr.trim()) return;
    const prop: PropertyDef = { name: n, type, options: [] };
    if (type === "relation") prop.collection = collection;
    if (type === "rollup") {
      if (reverse) {
        prop.from = via.slice("from:".length);
        prop.relation = relation.trim();
        if (where.trim()) prop.where = where.trim();
      } else {
        prop.relation = via.slice("rel:".length);
      }
      prop.function = fn;
      if (fn !== "count" && fn !== "percent" && property.trim()) prop.property = property.trim();
    }
    if (type === "formula") prop.expr = expr.trim();
    onAdd(prop);
    setName(""); setType("text"); setCollection(""); setVia(""); setRelation(""); setProperty(""); setFn("count"); setWhere(""); setExpr("");
    setOpen(false);
  };

  return (
    <div className={styles.addProp} ref={ref}>
      <button className={styles.addPropBtn} title="Add a property" onClick={() => setOpen((o) => !o)}>+</button>
      {open && (
        <div className={styles.addPropMenu}>
          <input
            className={styles.addPropInput}
            autoFocus
            value={name}
            placeholder="Property name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false); }}
          />
          <Dropdown
            fullWidth
            value={type}
            options={ADD_PROP_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            onChange={(v) => setType(v as PropType)}
          />

          {type === "relation" && (
            <Dropdown
              fullWidth
              value={collection}
              placeholder="Links to…"
              options={collections.map((c) => ({ value: c, label: c }))}
              onChange={setCollection}
            />
          )}

          {type === "rollup" && (
            <>
              <Dropdown
                fullWidth
                value={via}
                placeholder="Via relation…"
                options={viaOptions}
                onChange={(v) => { setVia(v); if (!v.startsWith("from:") && fn === "percent") setFn("count"); }}
              />
              {reverse && (
                <input
                  className={styles.addPropInput}
                  value={relation}
                  placeholder="Their property that links here"
                  onChange={(e) => setRelation(e.target.value)}
                />
              )}
              <Dropdown
                fullWidth
                value={fn}
                options={fns.map((f) => ({ value: f, label: f }))}
                onChange={setFn}
              />
              {fn !== "count" && fn !== "percent" && (
                <input
                  className={styles.addPropInput}
                  value={property}
                  placeholder="Property to aggregate"
                  onChange={(e) => setProperty(e.target.value)}
                />
              )}
              {reverse && (
                <input
                  className={styles.addPropInput}
                  value={where}
                  placeholder={fn === "percent" ? "where, e.g. done == true" : "where (optional)"}
                  onChange={(e) => setWhere(e.target.value)}
                />
              )}
              {viaOptions.length === 0 && <div className={styles.addPropHint}>Add a Relation property first.</div>}
            </>
          )}

          {type === "formula" && (
            <>
              <textarea
                className={styles.addPropInput}
                rows={3}
                value={expr}
                spellCheck={false}
                placeholder="budget - spent"
                onChange={(e) => setExpr(e.target.value)}
              />
              <div className={styles.addPropHint}>{FORMULA_HINT}</div>
            </>
          )}

          <button className={styles.addPropConfirm} onClick={submit}>Add property</button>
        </div>
      )}
    </div>
  );
}

/** Only collection rows are notes that can be opened in the full editor. */
function rowNotePath(source: string, rowId: string): string | null {
  if (!source.startsWith("collections/")) return null;
  return `${source.replace(/\/$/, "")}/${rowId}.md`;
}

/** Ask the app shell to open a collection row as a full note (Notion-style). */
function openRow(source: string, rowId: string) {
  const path = rowNotePath(source, rowId);
  if (path) window.dispatchEvent(new CustomEvent("cortex:open-note", { detail: { path } }));
}

export const VIEW_LANGUAGES = ["cortex-view", "cortex-chart"];

// Naive single-level YAML peek — for header chrome only; the real parse + query
// happens in the Rust engine via commands.runView.
function peek(spec: string, key: string): string | undefined {
  const m = spec.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m?.[1]?.trim();
}

/** A map-valued spec key (`summary: {amount: sum}` on one line, or a YAML
 *  block of `  field: function` lines) as an object. */
function peekMap(spec: string, key: string): Record<string, string> {
  const out: Record<string, string> = {};
  const flow = spec.match(new RegExp(`^${key}:[ \\t]*\\{(.*)\\}[ \\t]*$`, "m"));
  const block = flow ? null : spec.match(new RegExp(`^${key}:[ \\t]*\\n((?:[ \\t]+\\S.*(?:\\n|$))+)`, "m"));
  const pairs = flow ? flow[1].split(",") : block ? block[1].split("\n") : [];
  for (const part of pairs) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k && v) out[k] = v;
  }
  return out;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return formatRange(v) || JSON.stringify(v);
  return String(v);
}

function fmtNum(n: number): string {
  if (!isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Number display formats a schema can declare (`format:`). */
const NUMBER_FORMATS: { value: string; label: string }[] = [
  { value: "", label: "Plain" },
  { value: "integer", label: "Integer" },
  { value: "decimal", label: "Decimal" },
  { value: "percent", label: "Percent" },
  { value: "progress", label: "Progress bar" },
  { value: "ring", label: "Ring" },
  { value: "currency", label: "Currency" },
  { value: "stars", label: "Stars" },
];

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return isFinite(n) ? n : null; }
  return null;
}

/** A column's number format, when it declares one we know how to draw. */
function numberFormat(c: ViewColumn): string | undefined {
  const f = c.schema?.format;
  return f && NUMBER_FORMATS.some((o) => o.value === f) ? f : undefined;
}

/** The text of a formatted number — what a bar or the stars carry as a label. */
export function formatNumber(n: number, schema: PropertyDef | undefined): string {
  const unit = schema?.unit ?? "";
  switch (schema?.format) {
    case "percent": return `${fmtNum(n)}%`;
    case "currency": return `${unit}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
    case "integer": return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
    case "decimal": return new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
    case "progress":
    case "ring": {
      // A bare 0–100 bar is a share, so it reads as one; a custom range or unit reads as itself.
      const bare = schema.min === undefined && schema.max === undefined && !unit;
      return `${fmtNum(n)}${bare ? "%" : unit}`;
    }
    default: return fmtNum(n);
  }
}

/** At-rest rendering of a formatted number: a bar, stars, or text. Stars are
 *  clickable when `onSet` is given — the n-th star writes n. */
function FormattedNumber({ value, schema, onSet }: { value: unknown; schema: PropertyDef; onSet?: (n: number) => void }) {
  const n = toNumber(value);
  if (schema.format === "stars") {
    const max = Math.max(1, Math.round(schema.max ?? 5));
    const filled = n === null ? 0 : Math.round(n);
    return (
      <span className={`${styles.stars} ${onSet ? styles.starsSet : ""}`} title={n === null ? "—" : `${formatNumber(n, schema)} of ${max}`}>
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={`${styles.star} ${i < filled ? styles.starOn : ""}`}
            onClick={onSet ? (e) => { e.stopPropagation(); onSet(i + 1); } : undefined}
            role={onSet ? "button" : undefined}
            aria-label={`${i + 1} of ${max}`}
          >★</span>
        ))}
      </span>
    );
  }
  if (n === null) return <>{formatCell(value)}</>;
  if (schema.format === "ring") {
    const lo = schema.min ?? 0, hi = schema.max ?? 100;
    return <Ring pct={hi > lo ? ((n - lo) / (hi - lo)) * 100 : 0} text={formatNumber(n, schema)} />;
  }
  if (schema.format === "progress") {
    const lo = schema.min ?? 0, hi = schema.max ?? 100;
    const pct = hi > lo ? Math.min(100, Math.max(0, ((n - lo) / (hi - lo)) * 100)) : 0;
    return (
      <span className={styles.progress}>
        <span className={styles.progressTrack}><span className={styles.progressFill} style={{ width: `${pct}%` }} /></span>
        <span className={styles.progressNum}>{formatNumber(n, schema)}</span>
      </span>
    );
  }
  return <>{formatNumber(n, schema)}</>;
}

/** A cell for display only: formatted when its column declares a number format, else plain text. */
function displayCell(c: ViewColumn, v: unknown): ReactNode {
  return numberFormat(c) ? <FormattedNumber value={v} schema={c.schema!} /> : formatCell(v);
}

/** Today's date in the user's own timezone — the same day the calendar shows. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function newRowId(): string {
  return `row-${Date.now().toString(36)}`;
}

// A new row in a filtered view would otherwise vanish (it can't match the
// filter). Seed it with the view's top-level equality constraints so it shows
// up where the user expects — e.g. filter `status == 'reading'` → status:reading.
export function seedFromFilter(spec: string): Record<string, string> {
  const filter = peek(spec, "filter");
  if (!filter || /\bor\b/i.test(filter)) return {};
  const seed: Record<string, string> = {};
  for (const clause of filter.split(/\band\b/i)) {
    const m = clause.trim().match(/^([A-Za-z_$][\w$]*)\s*==?\s*(.+)$/);
    if (m) seed[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return seed;
}

/** Starter specs used by the slash-menu inserts. */
export const STARTER_VIEW_SPEC = `source: collections/books
type: table
columns: [title, author, rating]`;

export const STARTER_BOARD_SPEC = `source: collections/books
type: board
group: status`;

export const STARTER_CALENDAR_SPEC = `source: collections/books
type: calendar
date: created`;

export const STARTER_GALLERY_SPEC = `source: collections/books
type: gallery`;

export const STARTER_LIST_SPEC = `source: collections/books
type: list`;

export const STARTER_CHART_SPEC = `source: data/weight.csv
type: chart
chartType: line
x: date
y: weight`;

export const STARTER_TRACKER_SPEC = `source: collections/habits
type: tracker
log: collections/habit-log
range: week`;

export const STARTER_TIMELINE_SPEC = `source: collections/projects
type: timeline
start: start
end: end`;

/** Series colours: the accent first, then the tag palette — theme tokens, never hex. */
const SERIES_COLORS = ["var(--accent)", "var(--tag-green-fg)", "var(--tag-orange-fg)", "var(--tag-purple-fg)", "var(--tag-pink-fg)", "var(--tag-yellow-fg)", "var(--tag-brown-fg)", "var(--tag-red-fg)", "var(--tag-blue-fg)"];

/** The wrapper class for a chart's `height:`. */
function chartHeightClass(chart: ChartResult): string {
  return chart.height === "small" ? styles.chartSmall : chart.height === "large" ? styles.chartLarge : "";
}

/** Dependency-free SVG chart: line, bar, area, donut or pie. One series, or
 *  several when the spec sets `series:` (lines overlaid, bars grouped or
 *  stacked). Responsive via viewBox. */
export function MiniChart({ chart }: { chart: ChartResult }) {
  if (chart.chartType === "donut" || chart.chartType === "pie") return <RoundChart chart={chart} />;
  if (chart.series && chart.series.length > 1) return <MultiChart chart={chart} />;
  const W = 640, H = 240;
  const padL = 46, padR = 16, padT = 14, padB = 38;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const ys = chart.points.map((p) => p.y);
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.06;
  max += span * 0.06;

  const n = chart.points.length;
  const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => padT + innerH - ((v - min) / (max - min)) * innerH;

  const isBar = chart.chartType === "bar";
  const isArea = chart.chartType === "area";
  const ticks = [max, (min + max) / 2, min];
  const baseY = yAt(Math.max(0, min));
  const labelEvery = Math.ceil(n / 6);

  return (
    <div className={`${styles.chartWrap} ${chartHeightClass(chart)}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} preserveAspectRatio="xMidYMid meet">
        {ticks.map((t, i) => {
          const y = yAt(t);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} className={styles.grid} />
              <text x={padL - 6} y={y + 3} textAnchor="end" className={styles.axisLabel}>{fmtNum(t)}</text>
            </g>
          );
        })}

        {isBar
          ? chart.points.map((p, i) => {
              const bw = n <= 1 ? innerW * 0.35 : (innerW / n) * 0.6;
              const y = yAt(p.y);
              return (
                <rect
                  key={i}
                  x={xAt(i) - bw / 2}
                  y={Math.min(y, baseY)}
                  width={bw}
                  height={Math.max(1, Math.abs(baseY - y))}
                  rx={2}
                  className={styles.bar}
                />
              );
            })
          : (
            <>
              {isArea && n > 1 && (
                <polygon
                  points={`${xAt(0)},${baseY} ${chart.points.map((p, i) => `${xAt(i)},${yAt(p.y)}`).join(" ")} ${xAt(n - 1)},${baseY}`}
                  className={styles.area}
                />
              )}
              <polyline
                points={chart.points.map((p, i) => `${xAt(i)},${yAt(p.y)}`).join(" ")}
                className={styles.line}
              />
              {chart.points.map((p, i) => (
                <circle key={i} cx={xAt(i)} cy={yAt(p.y)} r={2.5} className={styles.dot} />
              ))}
            </>
          )}

        {chart.points.map((p, i) => {
          if (n > 6 && i % labelEvery !== 0 && i !== n - 1) return null;
          return (
            <text key={i} x={xAt(i)} y={H - padB + 18} textAnchor="middle" className={styles.axisLabel}>{p.x}</text>
          );
        })}
      </svg>
      <div className={styles.count}>{chart.yLabel} by {chart.xLabel} · {n} point{n === 1 ? "" : "s"}</div>
    </div>
  );
}

function MultiChart({ chart }: { chart: ChartResult }) {
  const W = 640, H = 260;
  const padL = 46, padR = 16, padT = 14, padB = 58;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xs = [...new Set(chart.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => {
    const [p, q] = [parseFloat(a), parseFloat(b)];
    return !isNaN(p) && !isNaN(q) ? p - q : a.localeCompare(b);
  });
  const isBar = chart.chartType === "bar";
  const isArea = chart.chartType === "area";
  // Stacked: each series sits on the sum of those before it, so the top of the
  // last one is the total per x.
  const stacked = chart.stack && (isBar || isArea);
  const byXs = chart.series.map((s) => new Map(s.points.map((p) => [p.x, p.y])));
  const base = (si: number, x: string) => stacked ? byXs.slice(0, si).reduce((acc, m) => acc + Math.max(0, m.get(x) ?? 0), 0) : 0;
  const top = (si: number, x: string) => base(si, x) + (byXs[si].get(x) ?? 0);
  const ys = chart.series.flatMap((_, si) => xs.map((x) => top(si, x)));
  let min = Math.min(0, ...ys), max = Math.max(...ys);
  if (min === max) { max = min + 1; }
  const span = max - min; max += span * 0.06;
  const n = xs.length;
  const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => padT + innerH - ((v - min) / (max - min)) * innerH;
  const slot = innerW / Math.max(1, n);
  const perSlot = stacked ? 1 : chart.series.length;
  const bw = Math.max(1, (slot * 0.7) / perSlot);
  const ticks = 3;
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  return (
    <div className={`${styles.chartWrap} ${chartHeightClass(chart)}`}>
      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = min + ((max - min) * i) / ticks;
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={yAt(v)} y2={yAt(v)} className={styles.grid} />
              <text x={padL - 6} y={yAt(v) + 3} textAnchor="end" className={styles.axisLabel}>{fmtNum(v)}</text>
            </g>
          );
        })}
        {chart.series.map((_, si) => {
          const color = SERIES_COLORS[si % SERIES_COLORS.length];
          if (isBar) {
            return xs.map((x, i) => {
              const y0 = base(si, x), y1 = top(si, x);
              const x0 = padL + i * slot + (slot - bw * perSlot) / 2 + (stacked ? 0 : si * bw);
              return <rect key={`${si}-${x}`} x={x0} y={yAt(Math.max(y0, y1))} width={bw} height={Math.max(0, Math.abs(yAt(y0) - yAt(y1)))} fill={color} opacity={0.9} rx={1} />;
            });
          }
          const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(top(si, x))}`).join(" ");
          if (isArea) {
            // The band between this series' baseline and its top.
            const back = [...xs].reverse().map((x, j) => `L${xAt(n - 1 - j)},${yAt(base(si, x))}`).join(" ");
            return (
              <g key={si}>
                <path d={`${line} ${back} Z`} fill={color} opacity={0.22} />
                <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
              </g>
            );
          }
          return <path key={si} d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />;
        })}
        {xs.map((x, i) => (i % labelEvery === 0 || i === n - 1) && (
          <text key={x} x={isBar ? padL + i * slot + slot / 2 : xAt(i)} y={H - padB + 16} textAnchor="middle" className={styles.axisLabel}>{x}</text>
        ))}
        {chart.legend && chart.series.map((s, si) => (
          <g key={`l${si}`} transform={`translate(${padL + si * 100}, ${H - 14})`}>
            <rect width={10} height={10} rx={2} fill={SERIES_COLORS[si % SERIES_COLORS.length]} />
            <text x={14} y={9} className={styles.axisLabel}>{s.name.length > 12 ? s.name.slice(0, 11) + "…" : s.name}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** A donut or pie: one slice per point, tag-palette colours, the slice's
 *  value on hover, and the keyboard cycles slices (arrows) once the chart has
 *  focus. `labels:` picks what each slice says; `legend: false` hides the key. */
function RoundChart({ chart }: { chart: ChartResult }) {
  const [focus, setFocus] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const donut = chart.chartType === "donut";
  const slices = chart.points.filter((p) => p.y > 0);
  const total = slices.reduce((s, p) => s + p.y, 0);
  const S = 220, cx = S / 2, cy = S / 2, R = 100, r = donut ? 62 : 0;
  const arcs: { i: number; x: string; y: number; a0: number; a1: number }[] = [];
  let a = -Math.PI / 2;
  slices.forEach((p, i) => { const a1 = a + (p.y / total) * 2 * Math.PI; arcs.push({ i, x: p.x, y: p.y, a0: a, a1 }); a = a1; });
  const pt = (rad: number, ang: number) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
  const path = (a0: number, a1: number) => {
    // A lone slice is the whole ring: two half arcs, since one arc cannot close on itself.
    if (a1 - a0 >= 2 * Math.PI - 1e-6) {
      const mid = a0 + Math.PI;
      const outer = `M${pt(R, a0)} A${R},${R} 0 1 1 ${pt(R, mid)} A${R},${R} 0 1 1 ${pt(R, a0)}`;
      return donut ? `${outer} M${pt(r, a0)} A${r},${r} 0 1 0 ${pt(r, mid)} A${r},${r} 0 1 0 ${pt(r, a0)} Z` : `${outer} Z`;
    }
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return donut
      ? `M${pt(R, a0)} A${R},${R} 0 ${large} 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 ${large} 0 ${pt(r, a0)} Z`
      : `M${cx},${cy} L${pt(R, a0)} A${R},${R} 0 ${large} 1 ${pt(R, a1)} Z`;
  };
  const active = hover ?? focus;
  const pct = (y: number) => `${fmtNum((y / total) * 100)}%`;
  const labelText = (arc: { x: string; y: number }) => {
    switch (chart.labels) {
      case "value": return fmtNum(arc.y);
      case "name_value": return `${arc.x} ${fmtNum(arc.y)}`;
      case "none": return "";
      default: return arc.x;
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (arcs.length === 0) return;
    const step = (d: number) => { e.preventDefault(); setFocus((f) => (f === null ? (d > 0 ? 0 : arcs.length - 1) : (f + d + arcs.length) % arcs.length)); };
    if (e.key === "ArrowRight" || e.key === "ArrowDown") step(1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") step(-1);
    else if (e.key === "Home") { e.preventDefault(); setFocus(0); }
    else if (e.key === "End") { e.preventDefault(); setFocus(arcs.length - 1); }
    else if (e.key === "Escape") setFocus(null);
  };
  const current = active !== null ? arcs[active] : null;
  const caption = current
    ? `${current.x}: ${fmtNum(current.y)} · ${pct(current.y)}`
    : `${chart.yLabel} by ${chart.xLabel} · ${slices.length} slice${slices.length === 1 ? "" : "s"} · total ${fmtNum(total)}`;
  if (arcs.length === 0) return <div className={styles.stub}>Nothing to draw — every value is zero or empty.</div>;
  return (
    <div className={`${styles.chartWrap} ${styles.roundWrap} ${chartHeightClass(chart)}`}>
      <svg
        viewBox={`0 0 ${S} ${S}`}
        className={`${styles.chart} ${styles.roundChart}`}
        preserveAspectRatio="xMidYMid meet"
        tabIndex={0}
        role="img"
        aria-label={caption}
        onKeyDown={onKey}
        onBlur={() => setFocus(null)}
        onMouseLeave={() => setHover(null)}
      >
        {arcs.map((arc) => {
          const on = active === arc.i;
          const mid = (arc.a0 + arc.a1) / 2;
          const shift = on ? 4 : 0;
          return (
            <path
              key={arc.i}
              d={path(arc.a0, arc.a1)}
              fill={SERIES_COLORS[arc.i % SERIES_COLORS.length]}
              className={`${styles.slice} ${on ? styles.sliceOn : ""}`}
              transform={shift ? `translate(${(shift * Math.cos(mid)).toFixed(2)} ${(shift * Math.sin(mid)).toFixed(2)})` : undefined}
              onMouseEnter={() => setHover(arc.i)}
              onClick={() => setFocus(arc.i)}
            >
              <title>{`${arc.x}: ${fmtNum(arc.y)} (${pct(arc.y)})`}</title>
            </path>
          );
        })}
        {chart.labels !== "none" && arcs.map((arc) => {
          if (arc.y / total < 0.06) return null;
          const mid = (arc.a0 + arc.a1) / 2;
          const rad = donut ? (R + r) / 2 : R * 0.62;
          const text = labelText(arc);
          return text ? (
            <text key={`t${arc.i}`} x={cx + rad * Math.cos(mid)} y={cy + rad * Math.sin(mid)} textAnchor="middle" dominantBaseline="central" className={styles.sliceLabel}>
              {text.length > 14 ? text.slice(0, 13) + "…" : text}
            </text>
          ) : null;
        })}
        {donut && (
          <>
            <text x={cx} y={cy - 6} textAnchor="middle" className={styles.roundValue}>{current ? fmtNum(current.y) : fmtNum(total)}</text>
            <text x={cx} y={cy + 12} textAnchor="middle" className={styles.roundSub}>{current ? `${current.x} · ${pct(current.y)}` : "total"}</text>
          </>
        )}
      </svg>
      {chart.legend && (
        <ul className={styles.legend}>
          {arcs.map((arc) => (
            <li
              key={arc.i}
              className={`${styles.legendItem} ${active === arc.i ? styles.legendOn : ""}`}
              onMouseEnter={() => setHover(arc.i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setFocus(arc.i)}
            >
              <span className={styles.legendSwatch} style={{ background: SERIES_COLORS[arc.i % SERIES_COLORS.length] }} />
              <span className={styles.legendName}>{arc.x}</span>
              <span className={styles.legendValue}>{fmtNum(arc.y)} · {pct(arc.y)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.count}>{caption}</div>
    </div>
  );
}

// ── Stats view: a few numbers, each its own query ────────────────────────────

/** A stat's value as text, in its format: a share with `%`, money grouped to
 *  two decimals, `—` for nothing. */
function statText(s: Stat): string {
  if (s.value === null) return s.text;
  const n = s.value;
  switch (s.format) {
    case "percent": case "progress": case "ring": return `${fmtNum(n)}%`;
    case "currency": return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    case "integer": return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
    case "decimal": return new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
    default: return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
  }
}

/** The tiles of a `stats` view: the value large, its label under it, a ring
 *  when the entry asks for one. Read-only — every number comes from the engine. */
export function StatsView({ stats }: { stats: StatsResult }) {
  if (stats.stats.length === 0) return <div className={styles.stub}>Add a `stats:` entry — a label, an aggregate and a field, or an expression over other tiles.</div>;
  return (
    <div className={styles.stats}>
      {stats.stats.map((s, i) => (
        <div key={`${s.label}-${i}`} className={`${styles.statTile} ${s.error ? styles.statError : ""}`} title={s.error ?? undefined}>
          <div className={styles.statValue}>
            {s.format === "ring" && s.value !== null
              ? <Ring inside size={56} pct={s.value} text={`${fmtNum(s.value)}%`} />
              : statText(s)}
          </div>
          <div className={styles.statLabel}>{s.label}</div>
          {s.error && <div className={styles.statNote}>{s.error}</div>}
        </div>
      ))}
    </div>
  );
}

/** A real checkbox for bool columns: one click flips it and writes a typed
 *  bool; Space toggles when focused. */
function CheckboxCell({ value, editable, saving, onCommit }: {
  value: unknown; editable: boolean; saving: boolean; onCommit: (v: string) => void;
}) {
  const on = value === true || value === "true";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      className={`${styles.checkbox} ${on ? styles.checkboxOn : ""}`}
      disabled={!editable || saving}
      onClick={(e) => { e.stopPropagation(); onCommit(on ? "false" : "true"); }}
      title={on ? "Yes — click to clear" : "No — click to tick"}
    >
      {on && <CheckIcon size={11} />}
    </button>
  );
}

function toInput(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return formatRange(v);
  return String(v);
}

function EditableCell({ value, editable, saving, onCommit, render, forceOpen, onDone }: {
  value: unknown;
  editable: boolean;
  saving: boolean;
  onCommit: (v: string) => void;
  /** At-rest rendering (a formatted number); the editor still edits the raw value. */
  render?: (v: unknown) => ReactNode;
  /** The table asks the cell to open (Enter on a focused cell). */
  forceOpen?: boolean;
  /** The editor closed, by commit or cancel — the table takes focus back. */
  onDone?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (forceOpen && editable && !editing) { setDraft(toInput(value)); setEditing(true); }
  }, [forceOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = render ? render(value) : formatCell(value);
  if (!editable) {
    return <span className={styles.cellReadonly}>{shown}</span>;
  }

  if (!editing) {
    return (
      <span
        className={`${styles.cellEditable} ${toInput(value).trim() === "" ? styles.cellEmpty : ""}`}
        title="Click to edit"
        onClick={() => { setDraft(toInput(value)); setEditing(true); }}
      >
        {saving ? "…" : shown}
      </span>
    );
  }

  const finish = (save: boolean) => {
    setEditing(false);
    const original = toInput(value);
    if (save && draft !== original) onCommit(draft);
    onDone?.();
  };

  return (
    <input
      className={styles.cellInput}
      autoFocus
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
      }}
      onBlur={() => finish(true)}
    />
  );
}

/** A date cell: at rest the day as stored; open, the date picker (typed input
 *  validated, or a click on the calendar). Nothing but a real day is written. */
function DateCell({ value, editable, saving, onCommit, forceOpen, onDone }: {
  value: unknown;
  editable: boolean;
  saving: boolean;
  onCommit: (v: string) => void;
  forceOpen?: boolean;
  onDone?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (forceOpen && editable) setEditing(true); }, [forceOpen, editable]);

  const text = toInput(value);
  if (!editable) return <span className={styles.cellReadonly}>{formatCell(value)}</span>;
  if (!editing) {
    return (
      <span
        className={`${styles.cellEditable} ${text.trim() === "" ? styles.cellEmpty : ""}`}
        title="Click to edit"
        onClick={() => setEditing(true)}
      >
        {saving ? "…" : formatCell(value)}
      </span>
    );
  }
  const close = () => { setEditing(false); onDone?.(); };
  return (
    <div className={styles.cellDate}>
      <DatePicker
        value={text}
        autoFocus
        inputClassName={styles.cellInput}
        onChange={(v) => { onCommit(v); close(); }}
        onCancel={close}
      />
    </div>
  );
}

/** A date-range cell: "start → end" at rest; open, two date pickers. The
 *  committed text carries both days; the engine stores `{start, end}`. */
function DateRangeCell({ value, editable, saving, onCommit, forceOpen, onDone }: {
  value: unknown;
  editable: boolean;
  saving: boolean;
  onCommit: (v: string) => void;
  forceOpen?: boolean;
  onDone?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (forceOpen && editable) setEditing(true); }, [forceOpen, editable]);
  if (!editable) return <span className={styles.cellReadonly}>{formatCell(value)}</span>;
  if (!editing) {
    const text = formatRange(value);
    return (
      <span className={`${styles.cellEditable} ${text === "" ? styles.cellEmpty : ""}`} title="Click to edit" onClick={() => setEditing(true)}>
        {saving ? "…" : formatCell(value)}
      </span>
    );
  }
  const close = () => { setEditing(false); onDone?.(); };
  return (
    <div className={styles.cellDate}>
      <DateRangeInput
        value={value}
        autoFocus
        inputClassName={styles.cellInput}
        onChange={(r) => { onCommit(r ? formatRange(r) : ""); if (!r || r.end) close(); }}
        onCancel={close}
      />
    </div>
  );
}

/** The width class for a column: a floor per kind of value so dates and pills
 *  never squeeze, and text never sprawls. */
function colClass(c: ViewColumn): string {
  const t = c.schema?.type;
  if (t === "relation" || t === "person" || t === "files" || isRangeColumn(c)) return styles.colRel;
  if (isSelectColumn(c)) return styles.colSel;
  if (c.ty === "date" || t === "date") return styles.colDate;
  if (c.ty === "bool" || t === "checkbox") return styles.colBool;
  if (c.ty === "number" || numberFormat(c)) return styles.colNum;
  return styles.colText;
}

/** What a blank new row starts with: a title, today, the view's filter seeds
 *  and, for a row made inside a table group, that group's value. */
function blankRowSeed(spec: string, extra?: Record<string, string>): Record<string, string> {
  return { title: "Untitled", created: today(), ...seedFromFilter(spec), ...(extra ?? {}) };
}

type CellPos = { r: number; c: number };

/** mod+f inside a data view goes to its search box (the Shell leaves the key
 *  alone under a `data-find-scope` element). True when it was handled. */
function findKey(e: React.KeyboardEvent, onFind?: () => void): boolean {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!onFind || !mod || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f") return false;
  e.preventDefault(); e.stopPropagation();
  onFind();
  return true;
}

/** The rows whose title, visible cells or body contain `query` — the toolbar's
 *  search, applied on the client to what the engine returned. Never part of
 *  the spec, so the file on disk stays as written. */
export function searchRows(table: ViewTable, query: string): ViewTable {
  const q = query.trim().toLowerCase();
  if (!q) return table;
  const keys = [...new Set(["title", ...table.columns.map((c) => c.key), "$body"])];
  const rows = table.rows.filter((row) => keys.some((k) => toInput(row.cells[k]).toLowerCase().includes(q)));
  return { ...table, rows };
}

/** The summary functions a table's footer can pick per column. */
const SUMMARY_FUNCTIONS: { value: string; label: string }[] = [
  { value: "count", label: "Count" },
  { value: "empty", label: "Empty" },
  { value: "not_empty", label: "Not empty" },
  { value: "percent_checked", label: "Checked" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
];

/** Which functions make sense for a column: every column counts; numbers add
 *  the arithmetic, dates a min/max, checkboxes the share ticked. */
function summaryChoices(c: ViewColumn): { value: string; label: string }[] {
  const t = c.schema?.type;
  const numeric = isNumericColumn(c);
  const date = c.ty === "date" || t === "date";
  const bool = c.ty === "bool" || t === "checkbox";
  return SUMMARY_FUNCTIONS.filter((f) => {
    switch (f.value) {
      case "sum": case "avg": return numeric;
      case "min": case "max": return numeric || date;
      case "percent_checked": return bool;
      default: return true;
    }
  });
}

/** The engine's summary value as text — a number in the column's own format. */
function formatSummary(c: ViewColumn, func: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = toNumber(v);
  if (n === null) return formatCell(v);
  if (func === "percent_checked") return `${fmtNum(n)}%`;
  if (func === "count" || func === "empty" || func === "not_empty") return fmtNum(n);
  return c.schema && numberFormat(c) && !["stars", "progress", "ring"].includes(c.schema.format ?? "")
    ? formatNumber(n, c.schema)
    : fmtNum(n);
}

/** One footer cell: the chosen function and its value, or a hover "Calculate"
 *  picker when the view can be edited. Nothing here is written to a row —
 *  the pick goes into the view spec, the value comes from the engine. */
function SummaryCell({ col, func, value, onPick }: {
  col: ViewColumn; func: string | undefined; value: unknown; onPick?: (func: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const label = SUMMARY_FUNCTIONS.find((f) => f.value === func)?.label ?? func;
  const body = func
    ? <><span className={styles.summaryLabel}>{label}</span> <span className={styles.summaryValue}>{formatSummary(col, func, value)}</span></>
    : <span className={styles.summaryLabel}>Calculate</span>;
  if (!onPick) return func ? <span className={styles.summaryCell}>{body}</span> : null;
  return (
    <div className={`${styles.summaryWrap} ${func ? styles.summarySet : ""}`} ref={ref}>
      <button className={styles.summaryBtn} title="Summarise this column" onClick={() => setOpen((o) => !o)}>
        {body} <span className={styles.summaryCaret}>▾</span>
      </button>
      {open && (
        <div className={styles.summaryMenu}>
          <button className={styles.newRowItem} onClick={() => { setOpen(false); onPick(null); }}>None{!func ? " ✓" : ""}</button>
          {summaryChoices(col).map((f) => (
            <button key={f.value} className={styles.newRowItem} onClick={() => { setOpen(false); onPick(f.value); }}>
              {f.label}{func === f.value ? " ✓" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One `group:` section of the table: its rows, and where they start in the
 *  flat display order the keyboard navigates. `label` is the heading (a bucket
 *  such as `September 2026`, else the value); `summary` the engine's numbers
 *  over this section's rows. */
type GroupSection = { key: string; label: string; rows: ViewTable["rows"]; start: number; folded: boolean; summary?: ViewGroup["summary"] };

/** The sections of a grouped table, in display order: the engine's `groups`
 *  when the table carries them (option order, or newest bucket first, each
 *  with its own summary), narrowed to the rows on show — a search may have
 *  dropped some; else the same buckets computed here. `""` keys become `—`. */
function groupSections(table: ViewTable, groupField: string, groupCol: ViewColumn | undefined): { key: string; label: string; rows: ViewTable["rows"]; summary?: ViewGroup["summary"] }[] {
  if (table.groups && table.groups.length) {
    const byId = new Map(table.rows.map((r) => [r.id, r]));
    return table.groups
      .map((g) => ({ key: g.key || "—", label: g.label, rows: g.rowIds.map((id) => byId.get(id)).filter((r): r is ViewTable["rows"][number] => !!r), summary: g.summary }))
      .filter((g) => g.rows.length > 0);
  }
  const groups = new Map<string, ViewTable["rows"]>();
  for (const row of table.rows) {
    const key = toInput(row.cells[groupField]) || "—";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const optionOrder = groupCol?.schema?.options?.map((o) => o.name) ?? [];
  const present = [...groups.keys()];
  const keys = [
    ...optionOrder.filter((o) => groups.has(o)),
    ...present.filter((p) => p !== "—" && !optionOrder.includes(p)).sort(),
    ...(groups.has("—") ? ["—"] : []),
  ];
  return keys.map((k) => ({ key: k, label: k, rows: groups.get(k) ?? [] }));
}

/** Whether a `group:` is a date folded by `bucket:` — its keys are months or
 *  weeks, not values a new row could carry. */
function isBucketed(spec: string, groupCol: ViewColumn | undefined): boolean {
  return !!peek(spec, "bucket") && peek(spec, "bucket") !== "none" && (groupCol?.ty === "date" || groupCol?.ty === "date_range" || groupCol?.schema?.type === "date");
}

/** A bucket key's first day — what a row added to (or dropped into) a bucketed
 *  section gets for its date: `2026-09` → `2026-09-01`, `2026-Q3` → `2026-07-01`. */
function bucketStart(key: string): string {
  const q = key.match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}-01`;
  if (/^\d{4}$/.test(key)) return `${key}-01-01`;
  if (/^\d{4}-\d{2}$/.test(key)) return `${key}-01`;
  return key;
}

/** One section's summary as text: `Sum 15 · Checked 40%`. */
function groupSummaryText(cols: ViewColumn[], funcs: Record<string, string> | undefined, values: ViewGroup["summary"]): string {
  if (!values || !funcs) return "";
  return cols
    .filter((c) => funcs[c.key] && values[c.key] !== undefined)
    .map((c) => `${SUMMARY_FUNCTIONS.find((f) => f.value === funcs[c.key])?.label ?? funcs[c.key]} ${formatSummary(c, funcs[c.key], values[c.key])}`)
    .join(" · ");
}

export function DataTable({ table, spec, source, onChanged, onSpecChange, onFind }: {
  table: ViewTable; spec: string; source: string; onChanged: () => void;
  /** Lets the footer write a `summary:` pick back into the view spec. */
  onSpecChange?: (nextSpec: string) => void;
  /** mod+f while the table has focus: hand focus to the toolbar's search box. */
  onFind?: () => void;
}) {
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Folded groups — a glance-state, kept in memory only.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Keyboard: one cell carries focus (a roving tabindex, like the sidebar);
  // `editKey` is the cell whose editor is open; a row we just made takes focus
  // once the reload brings it in.
  const tableRef = useRef<HTMLTableElement>(null);
  const [active, setActive] = useState<CellPos | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [menuRow, setMenuRow] = useState<string | null>(null);
  const [templatesVersion, setTemplatesVersion] = useState(0);
  // Below the phone breakpoint the grid becomes a card list (one card per
  // row; a tap opens it) — a nine-column table is nothing to a thumb.
  const { isPhone } = useViewport();
  // Whether DOM focus is inside the table: a cell editor that closes because
  // the user clicked elsewhere must not pull focus back here.
  const focusWithin = useRef(false);
  // A row made from the footer button deserves focus even though the click was outside.
  const claimFocus = useRef(false);
  // The id of the row under the cursor, so the cursor follows it when rows
  // reorder (a reload) or the rows above it fold away.
  const activeRowId = useRef<string | null>(null);

  const cols = table.columns;
  const schemaKey = collectionKey(source);
  const canOpen = source.startsWith("collections/");

  // ── Grouping: one section per value of `group:`, in the property's option
  // order, then other values, then the rows with none. Same buckets as the board.
  const groupField = peek(spec, "group");
  const groupCol = groupField ? cols.find((c) => c.key === groupField) : undefined;
  // `rows` is the table as shown, top to bottom — group by group, a folded
  // group left out. The keyboard's row index is an index into this list, so
  // arrows, Tab and the focus effect see one flat grid across every <tbody>.
  const bucketed = isBucketed(spec, groupCol);
  const { groupKeys, sections, rows } = useMemo(() => {
    const base = groupField ? groupSections(table, groupField, groupCol) : [];
    const groupKeys = base.map((g) => g.key);
    const sections: GroupSection[] = [];
    let start = 0;
    for (const g of base) {
      const folded = collapsed.has(g.key);
      sections.push({ ...g, start, folded });
      if (!folded) start += g.rows.length;
    }
    const rows = groupField ? sections.flatMap((s) => (s.folded ? [] : s.rows)) : table.rows;
    return { groupKeys, sections, rows };
  }, [table, groupField, groupCol, collapsed]);
  const toggleGroup = (g: string) =>
    setCollapsed((prev) => { const next = new Set(prev); if (next.has(g)) next.delete(g); else next.add(g); return next; });
  // A computed group value can't be seeded into a new row.
  const canAddInGroup = !!groupField && !(groupCol && isComputedColumn(groupCol));
  /** What a row added to section `key` carries: the value, or a bucket's first day. */
  const groupSeed = (key: string): Record<string, string> =>
    groupField ? { [groupField]: key === "—" ? "" : bucketed ? bucketStart(key) : key } : {};
  const colCount = cols.length + (schemaKey ? 1 : 0) + 1;
  /** The seed that lands a new row in the same group as `row`. */
  const groupSeedOf = (row: ViewTable["rows"][number] | undefined): Record<string, string> | undefined =>
    row && groupField && canAddInGroup && !bucketed ? { [groupField]: toInput(row.cells[groupField]) } : undefined;

  const cellKey = (p: CellPos) => `${rows[p.r]?.id}:${cols[p.c]?.key}`;

  const moveTo = (p: CellPos | null) => {
    activeRowId.current = p ? rows[p.r]?.id ?? null : null;
    setActive(p);
  };

  const focusCell = (r: number, c: number) => {
    if (rows.length === 0 || cols.length === 0) return;
    moveTo({ r: Math.max(0, Math.min(rows.length - 1, r)), c: Math.max(0, Math.min(cols.length - 1, c)) });
    setFocusTick((t) => t + 1);
  };

  // Put DOM focus on the active cell after each move (never while its editor
  // holds the focus — that would close the editor).
  useLayoutEffect(() => {
    if (!active || editKey || focusTick === 0) return;
    if (!focusWithin.current && !claimFocus.current) return;
    claimFocus.current = false;
    tableRef.current?.querySelector<HTMLElement>(`td[data-r="${active.r}"][data-c="${active.c}"]`)?.focus();
  }, [active, editKey, focusTick]);

  // The display order changed under us — a reload, or a group folded: land
  // on the row we just added, else follow the row the cursor was on (or the
  // nearest that still shows). A reload also puts DOM focus back on the cell.
  const lastRows = useRef(table.rows);
  useEffect(() => {
    const reloaded = lastRows.current !== table.rows;
    lastRows.current = table.rows;
    if (pendingRowId && reloaded) {
      const idx = rows.findIndex((r) => r.id === pendingRowId);
      setPendingRowId(null);
      if (idx >= 0) { claimFocus.current = true; focusCell(idx, 0); return; }
    }
    if (!active) return;
    let next: CellPos | null = active;
    const idx = activeRowId.current ? rows.findIndex((r) => r.id === activeRowId.current) : -1;
    if (idx >= 0) next = idx === active.r ? active : { r: idx, c: active.c };
    else if (active.r >= rows.length) next = rows.length ? { r: rows.length - 1, c: active.c } : null;
    // Never yank focus out of an editor the user opened with the mouse.
    const el = document.activeElement as HTMLElement | null;
    const typing = !!el && !!tableRef.current?.contains(el) && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    if (next && reloaded && focusWithin.current && !editKey && !typing) {
      focusCell(next.r, next.c);
    } else if (next !== active) {
      moveTo(next);
    }
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (col: ViewTable["columns"][number], rowId: string, value: string, ty?: string) => {
    const key = `${rowId}:${col.key}`;
    setSavingKey(key);
    setErr(null);
    commands.setCell(source, rowId, col.key, value, ty ?? col.ty)
      .then(() => onChanged())
      .catch((e) => setErr(String(e)))
      .finally(() => setSavingKey(null));
  };

  const del = (rowId: string) => {
    if (!window.confirm("Delete this row?")) return;
    commands.deleteRow(source, rowId).then(onChanged).catch((e) => setErr(String(e)));
  };

  /** A blank row, seeded from the filter and (for a group's button, or `n`
   *  inside a group) the group's value; it takes focus when it arrives. */
  const addBlank = (extra?: Record<string, string>) => {
    const id = newRowId();
    setPendingRowId(id);
    commands.addRow(source, id, blankRowSeed(spec, extra)).then(onChanged).catch((e) => { setPendingRowId(null); setErr(String(e)); });
  };

  const duplicate = (rowId: string) => {
    const id = newRowId();
    setPendingRowId(id);
    commands.duplicateRow(source, rowId, id, today()).then(onChanged).catch((e) => { setPendingRowId(null); setErr(String(e)); });
  };

  const saveAsTemplate = (rowId: string) => {
    const name = window.prompt("Template name")?.trim();
    if (!name) return;
    commands.saveRowAsTemplate(source, rowId, name)
      .then(() => setTemplatesVersion((v) => v + 1))
      .catch((e) => setErr(String(e)));
  };

  const setColumnType = (col: ViewTable["columns"][number], type: PropType) => {
    if (!schemaKey) return;
    const { format, unit, min, max } = col.schema ?? {};
    commands.upsertProperty(schemaKey, { name: col.key, type, options: col.schema?.options ?? [], format, unit, min, max })
      .then(onChanged)
      .catch((e) => setErr(String(e)));
  };

  // Display settings for a number column. An untyped number column gets a
  // schema property on first use; an unset field is dropped, not sent as "".
  const setColumnFormat = (col: ViewTable["columns"][number], patch: Partial<PropertyDef>) => {
    if (!schemaKey) return;
    const base: PropertyDef = col.schema ?? { name: col.key, type: "number", options: [] };
    const next: PropertyDef = { ...base, ...patch };
    for (const k of ["format", "unit", "min", "max"] as const) {
      if (next[k] === undefined || next[k] === "") delete next[k];
    }
    commands.upsertProperty(schemaKey, next).then(onChanged).catch((e) => setErr(String(e)));
  };

  // Rename / delete rewrite the schema, every row and the views in one go
  // (`rename_property` / `delete_property`); the view re-runs, and the page's
  // own `_index.md` follows through the watcher.
  const renameColumn = (col: ViewTable["columns"][number], name: string) => {
    if (!schemaKey) return;
    setErr(null);
    commands.renameProperty(schemaKey, col.key, name).then(onChanged).catch((e) => setErr(String(e)));
  };
  const deleteColumn = (col: ViewTable["columns"][number]) => {
    if (!schemaKey) return;
    if (!window.confirm(`Delete "${col.key}" from every row of this collection?`)) return;
    setErr(null);
    commands.deleteProperty(schemaKey, col.key).then(onChanged).catch((e) => setErr(String(e)));
  };

  const isBool = (c: ViewColumn) => c.ty === "bool" || c.schema?.type === "checkbox";
  const isDate = (c: ViewColumn) => c.ty === "date" || c.schema?.type === "date";
  const cellEditable = (c: ViewColumn) => c.key !== "$body" && c.key !== "id" && !isComputedColumn(c);

  const renderCell = (c: ViewTable["columns"][number], row: ViewTable["rows"][number]) => {
    const key = `${row.id}:${c.key}`;
    const opening = editKey === key;
    const done = () => { setEditKey(null); setFocusTick((t) => t + 1); };
    // Computed columns — rollups, formulas, the reverse side of a relation — are read-only.
    if (isComputedColumn(c)) {
      return <span className={styles.cellReadonly}>{displayCell(c, row.cells[c.key])}</span>;
    }
    if (isSelectColumn(c)) {
      const t = c.schema!.type;
      const multi = t === "multi_select" || t === "relation";
      // Person + relation options come from elsewhere (roster / target collection),
      // so they aren't editable inline like a regular select's options.
      const managed = t === "person" || t === "relation";
      return (
        <div className={styles.cellPills}>
        <SelectCell
          value={row.cells[c.key]}
          options={c.schema!.options ?? []}
          multi={multi}
          editable={c.key !== "$body" && c.key !== "id"}
          placeholder={t === "person" ? "Unassigned" : t === "relation" ? "Link…" : "Empty"}
          forceOpen={opening}
          onClose={done}
          onChange={(next) => {
            const value = Array.isArray(next) ? next.join(", ") : next;
            commit(c, row.id, value, multi ? "list" : "text");
          }}
          onOptionsChange={schemaKey && !managed ? (opts) => {
            commands.upsertProperty(schemaKey, { name: c.key, type: c.schema!.type, options: opts })
              .then(onChanged).catch((e) => setErr(String(e)));
          } : undefined}
        />
        </div>
      );
    }
    if (isBool(c)) {
      return (
        <CheckboxCell
          value={row.cells[c.key]}
          editable={c.key !== "$body" && c.key !== "id"}
          saving={savingKey === key}
          onCommit={(v) => commit(c, row.id, v, "bool")}
        />
      );
    }
    const editable = c.key !== "$body" && c.key !== "id";
    if (isRangeColumn(c)) {
      return (
        <DateRangeCell
          value={row.cells[c.key]}
          editable={editable}
          saving={savingKey === key}
          onCommit={(v) => commit(c, row.id, v, "date_range")}
          forceOpen={opening}
          onDone={done}
        />
      );
    }
    if (c.schema?.type === "files") {
      return (
        <FilesInput
          value={row.cells[c.key]}
          editable={editable}
          compact
          onChange={(next) => commit(c, row.id, next.join(", "), "list")}
        />
      );
    }
    if (isDate(c)) {
      return (
        <DateCell
          value={row.cells[c.key]}
          editable={editable}
          saving={savingKey === key}
          onCommit={(v) => commit(c, row.id, v, "date")}
          forceOpen={opening}
          onDone={done}
        />
      );
    }
    const fmt = numberFormat(c);
    // Stars are set by clicking one; every other format keeps the text editor.
    if (fmt === "stars") {
      return (
        <FormattedNumber
          value={row.cells[c.key]}
          schema={c.schema!}
          onSet={editable ? (n) => commit(c, row.id, String(n), "number") : undefined}
        />
      );
    }
    return (
      <EditableCell
        value={row.cells[c.key]}
        editable={editable}
        saving={savingKey === key}
        onCommit={(v) => commit(c, row.id, v)}
        render={fmt ? (v) => <FormattedNumber value={v} schema={c.schema!} /> : undefined}
        forceOpen={opening}
        onDone={done}
      />
    );
  };

  /** Enter on the focused cell: open its editor, or flip a checkbox. */
  const editActive = (p: CellPos) => {
    const c = cols[p.c], row = rows[p.r];
    if (!c || !row || !cellEditable(c)) return;
    if (isBool(c)) { const on = row.cells[c.key] === true || row.cells[c.key] === "true"; commit(c, row.id, on ? "false" : "true", "bool"); return; }
    if (c.schema?.format === "stars" || c.schema?.type === "files") return;
    setEditKey(cellKey(p));
  };

  /** Next / previous cell, reading order, wrapping across rows. */
  const step = (p: CellPos, dir: 1 | -1) => {
    let { r, c } = p;
    c += dir;
    if (c >= cols.length) { c = 0; r += 1; }
    if (c < 0) { c = cols.length - 1; r -= 1; }
    if (r < 0 || r >= rows.length) return;
    focusCell(r, c);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    const target = e.target as HTMLElement;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const inField = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
    const activeRow = active ? rows[active.r] : undefined;
    // Ctrl+Enter opens the row from anywhere in it, even mid-edit.
    if (e.key === "Enter" && mod && activeRow && canOpen) {
      e.preventDefault(); e.stopPropagation();
      openRow(source, activeRow.id);
      return;
    }
    if (findKey(e, onFind)) return;
    if (inField) {
      // Tab commits what is being typed (editors commit on blur) and moves on.
      if (e.key === "Tab" && active) {
        e.preventDefault(); e.stopPropagation();
        setEditKey(null);
        step(active, e.shiftKey ? -1 : 1);
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const cur = active ?? { r: 0, c: 0 };
    let handled = true;
    switch (e.key) {
      case "ArrowDown": case "j": focusCell(cur.r + (active ? 1 : 0), cur.c); break;
      case "ArrowUp": case "k": focusCell(cur.r - 1, cur.c); break;
      case "ArrowRight": case "l": focusCell(cur.r, cur.c + (active ? 1 : 0)); break;
      case "ArrowLeft": case "h": focusCell(cur.r, cur.c - 1); break;
      case "Home": focusCell(cur.r, 0); break;
      case "End": focusCell(cur.r, cols.length - 1); break;
      case "Tab": {
        // At either end the Tab leaves the table, as it would anywhere else.
        const last = cur.r === rows.length - 1 && cur.c === cols.length - 1;
        const first = cur.r === 0 && cur.c === 0;
        if (!active || (e.shiftKey ? first : last)) { handled = false; break; }
        step(cur, e.shiftKey ? -1 : 1);
        break;
      }
      case "Enter": if (active) editActive(active); break;
      case "o": if (activeRow && canOpen) openRow(source, activeRow.id); break;
      case " ": if (active && cols[active.c] && (isBool(cols[active.c]) || isSelectColumn(cols[active.c]))) editActive(active); break;
      // A new row lands in the cursor's group, so it shows up where the eye is.
      case "n": addBlank(groupSeedOf(activeRow)); break;
      case "Delete": case "Backspace": if (activeRow) del(activeRow.id); break;
      case "Escape": setMenuRow(null); target.blur(); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  /** One row; `r` is its index in the display order (what the keyboard navigates). */
  const renderRow = (row: ViewTable["rows"][number], r: number) => (
    <tr key={row.id} className={active?.r === r ? styles.rowActive : undefined}>
      {cols.map((c, ci) => {
        const here = active?.r === r && active?.c === ci;
        return (
          <td
            key={c.key}
            data-r={r}
            data-c={ci}
            tabIndex={here || (!active && r === 0 && ci === 0) ? 0 : -1}
            className={here ? styles.cellActive : undefined}
            onFocus={(e) => { if (e.target === e.currentTarget && !here) moveTo({ r, c: ci }); }}
            onMouseDown={() => { if (!here) moveTo({ r, c: ci }); }}
          >
            {renderCell(c, row)}
          </td>
        );
      })}
      {schemaKey && <td className={styles.addPropCol} />}
      <td className={styles.rowActionCol}>
        <div className={styles.rowActions}>
          {canOpen && (
            <button className={styles.rowOpen} title="Open note" tabIndex={-1} onClick={() => openRow(source, row.id)}>
              <OpenIcon size={13} />
            </button>
          )}
          <RowMenu
            open={menuRow === row.id}
            onToggle={() => setMenuRow((m) => (m === row.id ? null : row.id))}
            items={[
              ...(canOpen ? [{ label: "Open", run: () => openRow(source, row.id) }] : []),
              { label: "Duplicate", run: () => duplicate(row.id) },
              ...(schemaKey ? [{ label: "Save as template…", run: () => saveAsTemplate(row.id) }] : []),
              { label: "Delete", run: () => del(row.id), danger: true },
            ]}
          />
        </div>
      </td>
    </tr>
  );

  // ── Summary row: functions from the spec, values from the engine.
  const summarySpec = peekMap(spec, "summary");
  const hasSummary = Object.keys(summarySpec).length > 0;
  const setSummary = (field: string, func: string | null) => {
    if (!onSpecChange) return;
    commands.parseViewSpec(spec)
      .then((s) => {
        const next = { ...(s.summary ?? {}) };
        if (func) next[field] = func; else delete next[field];
        return commands.serializeViewSpec({ ...s, summary: next });
      })
      .then(onSpecChange)
      .catch((e) => setErr(String(e)));
  };

  const footer = (
    <div className={styles.footer}>
      <NewRowButton source={source} spec={spec} onAddBlank={() => addBlank()} onChanged={onChanged} onError={setErr} templatesVersion={templatesVersion} />
      <span className={styles.count}>
        {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
        {groupField && groupKeys.length > 0 && ` · ${groupKeys.length} group${groupKeys.length === 1 ? "" : "s"}`}
        {err && <span className={styles.error}> · {err}</span>}
      </span>
    </div>
  );

  if (isPhone) {
    // The title, then the first three other columns that carry a value.
    const titleCol = cols.find((c) => c.key === "title") ?? cols.find((c) => c.key !== "$body" && c.key !== "id");
    const cardCols = cols.filter((c) => c !== titleCol && c.key !== "$body" && c.key !== "id").slice(0, 3);
    const renderCard = (row: ViewTable["rows"][number]) => (
      <div key={row.id} className={styles.rowCard} role="listitem">
        <div
          className={`${styles.rowCardMain} ${canOpen ? styles.rowCardOpen : ""}`}
          role={canOpen ? "button" : undefined}
          tabIndex={canOpen ? 0 : undefined}
          onClick={canOpen ? () => openRow(source, row.id) : undefined}
          onKeyDown={canOpen ? (e) => { if (e.key === "Enter") openRow(source, row.id); } : undefined}
        >
          <div className={styles.rowCardTitle}>{(titleCol && formatCell(row.cells[titleCol.key])) || "Untitled"}</div>
          {cardCols.filter((c) => hasValue(row.cells[c.key])).map((c) => (
            <div key={c.key} className={styles.rowCardField}>
              <span className={styles.rowCardKey}>{c.key}</span>
              {isSelectColumn(c)
                ? <SelectCell value={row.cells[c.key]} options={c.schema!.options ?? []} multi={c.schema!.type === "multi_select"} editable={false} onChange={() => {}} />
                : <span className={styles.rowCardValue}>{displayCell(c, row.cells[c.key])}</span>}
            </div>
          ))}
        </div>
        <RowMenu
          open={menuRow === row.id}
          onToggle={() => setMenuRow((m) => (m === row.id ? null : row.id))}
          items={[
            ...(canOpen ? [{ label: "Open", run: () => openRow(source, row.id) }] : []),
            { label: "Duplicate", run: () => duplicate(row.id) },
            ...(schemaKey ? [{ label: "Save as template…", run: () => saveAsTemplate(row.id) }] : []),
            { label: "Delete", run: () => del(row.id), danger: true },
          ]}
        />
      </div>
    );
    return (
      <div className={styles.tableWrap}>
        <div className={styles.cardList} role="list" aria-label="Rows">
          {!groupField && rows.map(renderCard)}
          {groupField && sections.map((s) => (
            <div key={s.key} className={styles.cardGroup}>
              <button className={styles.groupToggle} onClick={() => toggleGroup(s.key)} aria-expanded={!s.folded}>
                <span className={`${styles.groupChevron} ${s.folded ? styles.groupChevronFolded : ""}`}>▾</span>
                <span className={styles.groupTitle}>{s.key === "—" ? `No ${groupField}` : s.label}</span>
                <span className={styles.groupCount}>{s.rows.length}</span>
                {s.summary && <span className={styles.groupSummaryInline}>{groupSummaryText(cols, table.summaryFunctions, s.summary)}</span>}
              </button>
              {!s.folded && s.rows.map(renderCard)}
              {!s.folded && canAddInGroup && (
                <NewRowButton
                  source={source} spec={spec} onChanged={onChanged} onError={setErr}
                  extra={groupSeed(s.key)}
                  onAddBlank={() => addBlank(groupSeed(s.key))}
                  templatesVersion={templatesVersion}
                  compact
                />
              )}
            </div>
          ))}
        </div>
        {footer}
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table
        className={styles.table}
        ref={tableRef}
        onKeyDown={onKeyDown}
        onFocus={() => { focusWithin.current = true; }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) focusWithin.current = false; }}
        aria-label={`Table — ${tableKeysHint()}`}
        data-find-scope={onFind ? "" : undefined}
      >
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={colClass(c)}>
                <ColumnHeader
                  col={c}
                  canType={!!schemaKey && c.key !== "id" && c.key !== "$body"}
                  onSetType={(ty) => setColumnType(c, ty)}
                  onSetFormat={(patch) => setColumnFormat(c, patch)}
                  onRename={(name) => renameColumn(c, name)}
                  onDelete={() => deleteColumn(c)}
                />
              </th>
            ))}
            {schemaKey && (
              <th className={styles.addPropCol}>
                <AddPropertyHeader
                  columns={cols}
                  onAdd={(prop) =>
                    commands.upsertProperty(schemaKey, prop)
                      .then(onChanged).catch((e) => setErr(String(e)))}
                />
              </th>
            )}
            <th className={styles.rowActionCol} />
          </tr>
        </thead>
        {!groupField && <tbody>{rows.map(renderRow)}</tbody>}
        {groupField && sections.map((s) => (
          <tbody key={s.key} className={styles.group}>
            <tr className={styles.groupRow}>
              <td colSpan={colCount}>
                <button className={styles.groupToggle} onClick={() => toggleGroup(s.key)} aria-expanded={!s.folded}>
                  <span className={`${styles.groupChevron} ${s.folded ? styles.groupChevronFolded : ""}`}>▾</span>
                  <span className={styles.groupTitle}>{s.key === "—" ? `No ${groupField}` : s.label}</span>
                  <span className={styles.groupCount}>{s.rows.length}</span>
                  {s.folded && s.summary && <span className={styles.groupSummaryInline}>{groupSummaryText(cols, table.summaryFunctions, s.summary)}</span>}
                </button>
              </td>
            </tr>
            {!s.folded && s.rows.map((row, i) => renderRow(row, s.start + i))}
            {!s.folded && canAddInGroup && (
              <tr className={styles.groupAddRow}>
                <td colSpan={colCount}>
                  <NewRowButton
                    source={source} spec={spec} onChanged={onChanged} onError={setErr}
                    extra={groupSeed(s.key)}
                    onAddBlank={() => addBlank(groupSeed(s.key))}
                    templatesVersion={templatesVersion}
                    compact
                  />
                </td>
              </tr>
            )}
            {!s.folded && s.summary && hasSummary && (
              <tr className={styles.groupSummaryRow}>
                {cols.map((c) => (
                  <td key={c.key}>
                    {summarySpec[c.key] && <SummaryCell col={c} func={summarySpec[c.key]} value={s.summary?.[c.key]} />}
                  </td>
                ))}
                {schemaKey && <td className={styles.addPropCol} />}
                <td className={styles.rowActionCol} />
              </tr>
            )}
          </tbody>
        ))}
        {(hasSummary || onSpecChange) && (
          <tfoot>
            <tr className={styles.summaryRow}>
              {cols.map((c) => (
                <td key={c.key}>
                  <SummaryCell
                    col={c}
                    func={summarySpec[c.key]}
                    value={table.summary?.[c.key]}
                    onPick={onSpecChange ? (f) => setSummary(c.key, f) : undefined}
                  />
                </td>
              ))}
              {schemaKey && <td className={styles.addPropCol} />}
              <td className={styles.rowActionCol} />
            </tr>
          </tfoot>
        )}
      </table>
      {footer}
    </div>
  );
}

/** The "⋯" at the end of a row: open, duplicate, save as template, delete. */
function RowMenu({ open, onToggle, items }: {
  open: boolean;
  onToggle: () => void;
  items: { label: string; run: () => void; danger?: boolean }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onToggle(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onToggle]);
  return (
    <div className={styles.rowMenuWrap} ref={ref}>
      <button className={styles.rowMore} title="Row actions" tabIndex={-1} onClick={onToggle} aria-haspopup="menu" aria-expanded={open}>⋯</button>
      {open && (
        <div className={styles.rowMenu} role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={`${styles.newRowItem} ${it.danger ? styles.rowMenuDanger : ""}`}
              onClick={() => { onToggle(); it.run(); }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "New row" — a plain button, or a dropdown (Blank / templates / New template)
 *  when the collection has row templates. */
function NewRowButton({ source, spec, onAddBlank, onChanged, onError, extra, compact, templatesVersion = 0 }: {
  source: string; spec: string; onChanged: () => void; onError: (e: string) => void;
  /** Makes the blank row — the table's own, so the new row takes focus; a
   *  button without one (a view that is not a table) adds the row itself. */
  onAddBlank?: () => void;
  /** Fields seeded on top of the filter's — a table group's value, so the row lands in that section. */
  extra?: Record<string, string>;
  /** The quieter in-group button. */
  compact?: boolean;
  /** Bumped when a template was saved elsewhere, so the list refreshes. */
  templatesVersion?: number;
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const collection = collectionKey(source);

  const loadTemplates = useCallback(() => {
    if (collection) commands.listRowTemplates(source).then(setTemplates).catch(() => {});
  }, [source, collection]);
  useEffect(() => { loadTemplates(); }, [loadTemplates, templatesVersion]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const seed = () => blankRowSeed(spec, extra);
  const addBlank = onAddBlank ?? (() => {
    commands.addRow(source, newRowId(), seed()).then(onChanged).catch((e) => onError(String(e)));
  });
  const btnClass = compact ? styles.groupAddBtn : styles.newRowBtn;
  const addFromTemplate = (t: string) => {
    setOpen(false);
    commands.addRowFromTemplate(source, newRowId(), t, seed()).then(onChanged).catch((e) => onError(String(e)));
  };
  const newTemplate = async () => {
    setOpen(false);
    const name = window.prompt("Template name")?.trim();
    if (!name || !collection) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "template";
    const path = `collections/${collection}/_template-${slug}.md`;
    try {
      await commands.createNote(path, name, today());
      loadTemplates();
      // Open it so the user can fill in the default properties/body.
      window.dispatchEvent(new CustomEvent("cortex:open-note", { detail: { path } }));
    } catch (e) { onError(String(e)); }
  };

  if (!collection) {
    return <button className={btnClass} onClick={addBlank}>+ New row</button>;
  }

  return (
    <div className={`${styles.newRowWrap} ${compact ? styles.newRowCompact : ""}`} ref={ref}>
      <button className={btnClass} onClick={addBlank}>+ New row</button>
      <button className={`${styles.newRowCaret} ${compact ? styles.newRowCaretCompact : ""}`} title="New from template" onClick={() => setOpen((o) => !o)}>▾</button>
      {open && (
        <div className={styles.newRowMenu}>
          <button className={styles.newRowItem} onClick={() => { setOpen(false); addBlank(); }}>Blank</button>
          {templates.map((t) => (
            <button key={t} className={styles.newRowItem} onClick={() => addFromTemplate(t)}>{t}</button>
          ))}
          <div className={styles.newRowSep} />
          <button className={styles.newRowItem} onClick={newTemplate}>＋ New template…</button>
        </div>
      )}
    </div>
  );
}

/** Keys every note carries that say nothing about the row on a card. */
const CARD_HIDDEN = new Set(["created", "updated", "modified", "tags", "type", "icon", "cover", "parent", "id", "$body"]);

/** The properties a card shows under its title. A view that names `columns:`
 *  chose them; otherwise the first few real properties, never the bookkeeping
 *  ones, so a card stays a card and not a copy of the whole row. */
function cardFields(table: ViewTable, spec: string, exclude: string[], max: number): ViewColumn[] {
  const chosen = !!peek(spec, "columns");
  const cols = table.columns.filter((c) => !exclude.includes(c.key) && !["$body", "id", "cover"].includes(c.key));
  return chosen ? cols : cols.filter((c) => !CARD_HIDDEN.has(c.key)).slice(0, max);
}

/** Cards leave out what a row has no value for. */
function hasValue(v: unknown): boolean {
  return toInput(v).trim() !== "";
}

export function BoardView({ table, spec, source, onChanged }: {
  table: ViewTable;
  spec: string;
  source: string;
  onChanged: () => void;
}) {
  // Optimistic local rows so a dropped card jumps to its new column instantly,
  // before the write + reload round-trips.
  const [rows, setRows] = useState(table.rows);
  useEffect(() => { setRows(table.rows); }, [table.rows]);

  const groupField = peek(spec, "group");
  if (!groupField) {
    return <div className={styles.error}>Board view needs a <code>group:</code> field in the spec.</div>;
  }

  const groupCol = table.columns.find((c) => c.key === groupField);
  if (groupCol && isComputedColumn(groupCol)) {
    return <div className={styles.stub}>A board can't group by <code>{groupField}</code> — it is computed. Pick another property under Group.</div>;
  }

  // A date group folded by `bucket:` takes the engine's sections (newest
  // first, labelled `September 2026`); a card dropped there gets the bucket's
  // first day. Otherwise the board buckets by value here — the optimistic
  // `rows` move a dropped card before the reload.
  const bucketed = isBucketed(spec, groupCol);
  const groups = new Map<string, ViewTable["rows"]>();
  const labels = new Map<string, string>();
  let groupKeys: string[];
  if (bucketed) {
    for (const g of groupSections({ ...table, rows }, groupField, groupCol)) {
      groups.set(g.key, g.rows);
      labels.set(g.key, g.label);
    }
    groupKeys = [...groups.keys()];
  } else {
    for (const row of rows) {
      const key = toInput(row.cells[groupField]) || "—";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    // Column order: the group property's defined options first — so a status board
    // reads in the workflow order you chose, not alphabetically — then any other
    // present values, then the "no value" column. Defined options always appear as
    // a column (even when empty) so they're valid drop targets.
    const optionOrder = groupCol?.schema?.options?.map((o) => o.name) ?? [];
    const present = [...groups.keys()];
    const extras = present.filter((p) => p !== "—" && !optionOrder.includes(p)).sort();
    const none = groups.has("—") ? ["—"] : [];
    groupKeys = [...new Set([...optionOrder, ...extras, ...none])];
  }

  // Groups with no rows fold into one strip at the end (still drop targets), so
  // a board of eight aisles with two items doesn't scroll past six empty
  // columns. With no rows at all the columns stay: they are how you start.
  const anyRows = rows.length > 0;
  const shown = anyRows ? groupKeys.filter((g) => (groups.get(g) ?? []).length > 0) : groupKeys;
  const folded = anyRows ? groupKeys.filter((g) => (groups.get(g) ?? []).length === 0) : [];
  const valueOf = (group: string) => group === "—" ? "" : bucketed ? bucketStart(group) : group;

  const titleField =
    table.columns.find((c) => c.key === "title")?.key ??
    table.columns.find((c) => c.key !== groupField && c.key !== "$body")?.key ??
    "id";
  const fieldCols = cardFields(table, spec, [groupField, titleField], 4);

  const addToGroup = (value: string) => {
    const fields: Record<string, string> = {
      title: "Untitled",
      created: today(),
      ...seedFromFilter(spec),
      [groupField]: valueOf(value),
    };
    commands.addRow(source, newRowId(), fields).then(onChanged).catch((e) => window.alert(String(e)));
  };

  const del = (rowId: string) => {
    if (!window.confirm("Delete this row?")) return;
    commands.deleteRow(source, rowId).then(onChanged).catch((e) => window.alert(String(e)));
  };

  // Drop a card into a column → write its group field (e.g. status).
  const moveCard = (rowId: string, group: string) => {
    const value = valueOf(group);
    const row = rows.find((r) => r.id === rowId);
    if (!row || toInput(row.cells[groupField]) === value) return;
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [groupField]: value } } : r)));
    const ty = groupCol?.ty ?? "text";
    commands.setCell(source, rowId, groupField, value, ty)
      .then(onChanged)
      .catch((e) => { window.alert(String(e)); onChanged(); });
  };

  const canOpen = source.startsWith("collections/");

  return (
    <div className={styles.board}>
      {shown.map((g) => (
        <BoardColumn key={g} group={g} onDrop={(id) => moveCard(id, g)}>
          <div className={styles.boardColHeader}>
            <span className={styles.boardColTitle}>{labels.get(g) ?? g}</span>
            <span className={styles.boardColCount}>{(groups.get(g) ?? []).length}</span>
          </div>
          <div className={styles.boardCards}>
            {(groups.get(g) ?? []).map((row) => (
              <div
                key={row.id}
                className={styles.boardCard}
                {...dragSource({ payload: row.id, label: formatCell(row.cells[titleField]) })}
              >
                <div className={styles.cardActions}>
                  {canOpen && (
                    <button className={styles.cardOpen} title="Open note" onClick={() => openRow(source, row.id)}>
                      <OpenIcon size={12} />
                    </button>
                  )}
                  <button className={styles.cardDelete} title="Delete row" onClick={() => del(row.id)}>
                    <CloseIcon size={12} />
                  </button>
                </div>
                <div
                  className={canOpen ? styles.boardCardTitleOpen : styles.boardCardTitle}
                  onClick={canOpen ? () => openRow(source, row.id) : undefined}
                  title={canOpen ? "Open note" : undefined}
                >
                  {formatCell(row.cells[titleField])}
                </div>
                {fieldCols.filter((c) => hasValue(row.cells[c.key])).map((c) => (
                  <div key={c.key} className={styles.boardCardField}>
                    <span className={styles.boardCardKey}>{c.key}</span>
                    {isSelectColumn(c) ? (
                      <SelectCell
                        value={row.cells[c.key]}
                        options={c.schema!.options ?? []}
                        multi={c.schema!.type === "multi_select"}
                        editable={false}
                        onChange={() => {}}
                      />
                    ) : (
                      <span>{displayCell(c, row.cells[c.key])}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button className={styles.boardAdd} onClick={() => addToGroup(g)}>+ Add</button>
        </BoardColumn>
      ))}
      {folded.length > 0 && (
        <div className={styles.boardFolded}>
          <div className={styles.boardColHeader}>
            <span className={styles.boardColTitle}>Empty</span>
            <span className={styles.boardColCount}>{folded.length}</span>
          </div>
          {folded.map((g) => (
            <BoardFoldedChip key={g} group={g} onAdd={() => addToGroup(g)} onDrop={(id) => moveCard(id, g)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One board column: a drop target for cards (pointer drag-and-drop, so a
 *  held finger moves a card too — see lib/pointerDrag.ts). */
function BoardColumn({ group, onDrop, children }: { group: string; onDrop: (rowId: string) => void; children: ReactNode }) {
  const dropRef = useDropTarget<HTMLDivElement>(onDrop);
  return <div ref={dropRef} className={styles.boardCol} data-group={group}>{children}</div>;
}

/** An empty group, folded to a chip: still a drop target, and a tap adds a row. */
function BoardFoldedChip({ group, onAdd, onDrop }: { group: string; onAdd: () => void; onDrop: (rowId: string) => void }) {
  const dropRef = useDropTarget<HTMLButtonElement>(onDrop);
  return (
    <button ref={dropRef} type="button" className={styles.boardFoldedChip} title={`Add a row to ${group}`} onClick={onAdd}>
      <span>{group}</span><span className={styles.boardFoldedPlus}>+</span>
    </button>
  );
}

/** Resolve a cover value (vault path / data URI / URL) to a displayable src.
 *  A remote URL is fetched only when asked: an image in a row someone else
 *  wrote (a pack's seed) must not call home just because a view was opened. */
function AssetImg({ value, className }: { value: unknown; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [wanted, setWanted] = useState(false);
  const raw = typeof value === "string" ? value : "";
  const remote = /^https?:\/\//i.test(raw);
  useEffect(() => {
    let alive = true;
    setWanted(false);
    if (!raw || remote) { setSrc(null); return; }
    if (raw.startsWith("data:")) { setSrc(raw); return; }
    commands.readAsset(raw).then((d) => { if (alive) setSrc(d); }).catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [raw, remote]);
  if (remote && !wanted) {
    let host = "";
    try { host = new URL(raw).host; } catch { /* shown as-is */ }
    return (
      <button type="button" className={styles.remoteImg} title={raw}
        onClick={(e) => { e.stopPropagation(); setWanted(true); }}>
        Load image from {host || "the web"}
      </button>
    );
  }
  const shown = remote ? raw : src;
  if (!shown) return null;
  return <img src={shown} className={className} alt="" />;
}

/** Pick the date field for a calendar: explicit `date:`, else a date column,
 *  else a conventional fallback. */
function dateFieldFor(table: ViewTable, spec: string): string {
  const declared = peek(spec, "date");
  if (declared) return declared;
  const dateCol = table.columns.find((c) => (c.ty === "date" || c.ty === "date_range") && c.key !== "$body");
  if (dateCol) return dateCol.key;
  for (const k of ["date", "created", "due"]) {
    if (table.columns.some((c) => c.key === k)) return k;
  }
  return "created";
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
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
/** A cell's date as YYYY-MM-DD, or null when it is not one. */
function dateOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
/** A span written in one cell — `2026-09-01/2026-09-05` (also `..`, `–`, `→`, `to`). */
const RANGE_RE = /^(\d{4}-\d{2}-\d{2})\s*(?:\/|\.\.|–|—|->|→|to)\s*(\d{4}-\d{2}-\d{2})$/;
function spanOf(v: unknown): [string, string] | null {
  const m = typeof v === "string" ? v.trim().match(RANGE_RE) : null;
  return m ? [m[1], m[2]] : null;
}

/** The field that ends a span: `end:` in the spec, else the `end` column when
 *  rows are placed by `start`. Two unrelated date columns (`created`, `due`)
 *  are never paired on their own. */
function endFieldFor(table: ViewTable, spec: string, dateField: string): string | null {
  // Cells carry every field even when `columns:` hides some, so ask the source.
  const has = (k: string) => table.allColumns.includes(k) || table.columns.some((c) => c.key === k);
  const declared = peek(spec, "end");
  if (declared && declared !== dateField && has(declared)) return declared;
  return dateField === "start" && has("end") ? "end" : null;
}

export type CalendarMode = "month" | "week" | "day";
const CAL_MODES: { id: CalendarMode; label: string }[] = [
  { id: "month", label: "Month" }, { id: "week", label: "Week" }, { id: "day", label: "Day" },
];
function calendarMode(spec: string): CalendarMode {
  const m = peek(spec, "mode");
  return m === "week" || m === "day" ? m : "month";
}

interface CalEvent { id: string; title: string; start: string; end: string; color: string | null }

/** An event placed in one week's grid: 1-based column, span, lane (0 = first
 *  row under the day numbers), and whether it runs in from the week before or
 *  on past the weekend. */
interface Placed { ev: CalEvent; col: number; span: number; lane: number; before: boolean; after: boolean }

/** Lay one week's events out in lanes: earliest first, longer first among
 *  equals, each in the first lane where it fits. */
function placeWeek(events: CalEvent[], weekStart: Date): { placed: Placed[]; lanes: number } {
  const ws = ymd(weekStart), we = ymd(addDays(weekStart, 6));
  const inWeek = events
    .filter((e) => e.start <= we && e.end >= ws)
    .map((e) => {
      const col = e.start < ws ? 1 : daysBetween(weekStart, parseYmd(e.start)) + 1;
      const endCol = e.end > we ? 7 : daysBetween(weekStart, parseYmd(e.end)) + 1;
      return { ev: e, col, span: endCol - col + 1, before: e.start < ws, after: e.end > we };
    })
    .sort((a, b) => a.col - b.col || b.span - a.span || a.ev.title.localeCompare(b.ev.title));
  const laneEnds: number[] = [];
  const placed: Placed[] = inWeek.map((p) => {
    let lane = laneEnds.findIndex((end) => end < p.col);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = p.col + p.span - 1;
    return { ...p, lane };
  });
  return { placed, lanes: laneEnds.length };
}

export function CalendarView({ table, spec, source, onChanged, onModeChange }: {
  table: ViewTable; spec: string; source: string; onChanged: () => void;
  /** Persist a picked mode (`mode: week`) into the view. */
  onModeChange?: (mode: CalendarMode) => void;
}) {
  const dateField = dateFieldFor(table, spec);
  const endField = endFieldFor(table, spec, dateField);
  const canOpen = source.startsWith("collections/");
  // A month grid needs the width; a phone gets one week as a strip of days
  // and the picked day's rows under it.
  const { isPhone } = useViewport();
  // Event colour: the first select/status property's option colour, as on the timeline.
  const colorCol = table.columns.find((c) => c.schema?.type === "select" || c.schema?.type === "status");

  // One event per row with a date: a `{start, end}` range property, a span
  // written in one cell, or a plain date plus `end:`. Rows with no usable
  // date are left out.
  const events = useMemo<CalEvent[]>(() => {
    const out: CalEvent[] = [];
    for (const row of table.rows) {
      const raw = row.cells[dateField];
      const span = spanOf(raw);
      const dr = span ? null : rangeOf(raw);
      const start = span ? span[0] : dr ? dr.start : dateOf(raw);
      if (!start) continue;
      let end = span ? span[1] : dr?.end ? rangeEnd(dr) : endField ? dateOf(row.cells[endField]) : null;
      if (!end || end < start) end = start;
      const val = colorCol ? toInput(row.cells[colorCol.key]) : "";
      const color = colorCol?.schema?.options?.find((o) => o.name === val)?.color ?? null;
      out.push({ id: row.id, title: formatCell(row.cells["title"] ?? row.id), start, end, color });
    }
    return out;
  }, [table.rows, dateField, endField, colorCol]);

  const specMode = calendarMode(spec);
  const [mode, setMode] = useState<CalendarMode>(specMode);
  useEffect(() => { setMode(specMode); }, [specMode]);
  // A phone has no room for a month grid or the mode control: it always
  // shows one week as a strip of days with the picked day's events under it.
  // The spec's mode is kept, so a wider window gets it back.
  const effMode: CalendarMode = isPhone ? "week" : mode;
  // The month grid opens on the month with the most rows, else today; the
  // week and day views open on today.
  const [anchor, setAnchor] = useState<Date>(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    if (specMode !== "month") return t;
    const tally = new Map<string, number>();
    for (const e of events) tally.set(e.start.slice(0, 7), (tally.get(e.start.slice(0, 7)) ?? 0) + 1);
    const busiest = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return busiest ? parseYmd(`${busiest}-01`) : new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const pickMode = (m: CalendarMode) => {
    if (m === mode) return;
    // Leaving the month grid: land on today when it is in view, else stay put.
    if (mode === "month") {
      const t = new Date();
      if (t.getFullYear() === anchor.getFullYear() && t.getMonth() === anchor.getMonth()) setAnchor(t);
    }
    setMode(m);
    onModeChange?.(m);
  };

  const step = (dir: 1 | -1) => setAnchor((a) =>
    effMode === "month" ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : addDays(a, dir * (effMode === "week" ? 7 : 1)));
  const goToday = () => { const t = new Date(); t.setHours(0, 0, 0, 0); setAnchor(t); };

  const todayStr = ymd(new Date());
  const [picking, setPicking] = useState(false);
  const addOn = (day: string) =>
    commands.addRow(source, newRowId(), { ...blankRowSeed(spec), [dateField]: day })
      .then(onChanged).catch((e) => window.alert(String(e)));

  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  // The weeks on show: every week touching the month, one week, or none (day).
  const weekStarts: Date[] = [];
  if (effMode === "month") {
    const last = new Date(year, month + 1, 0);
    for (let w = mondayOf(new Date(year, month, 1)); w <= last; w = addDays(w, 7)) weekStarts.push(w);
  } else if (effMode === "week") {
    weekStarts.push(mondayOf(anchor));
  }

  const title = effMode === "month"
    ? `${MONTHS[month]} ${year}`
    : effMode === "week"
      ? weekLabel(weekStarts[0])
      : `${WEEKDAYS_LONG[(anchor.getDay() + 6) % 7]}, ${anchor.getDate()} ${MONTHS[month]} ${year}`;

  const eventStyle = (e: CalEvent): React.CSSProperties | undefined =>
    e.color ? { "--bar-bg": `var(--tag-${e.color}-bg)`, "--bar-fg": `var(--tag-${e.color}-fg)` } as React.CSSProperties : undefined;
  const eventTitle = (e: CalEvent) => e.start === e.end ? `${e.title} · ${e.start}` : `${e.title} · ${e.start} → ${e.end}`;

  const renderWeek = (weekStart: Date) => {
    const { placed, lanes } = placeWeek(events, weekStart);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    // Rows: the day numbers, one per lane, then a stretch of empty cell.
    const rows = `auto repeat(${lanes}, auto) minmax(${effMode === "week" ? 120 : 24}px, 1fr)`;
    return (
      <div key={ymd(weekStart)} className={styles.calWeek} style={{ gridTemplateRows: rows }}>
        {days.map((d, i) => {
          const key = ymd(d);
          const outside = effMode === "month" && d.getMonth() !== month;
          return (
            <div
              key={`bg-${key}`}
              className={`${styles.calCell} ${outside ? styles.calOutside : ""} ${key === todayStr ? styles.calCellToday : ""}`}
              style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
            />
          );
        })}
        {days.map((d, i) => {
          const key = ymd(d);
          const outside = effMode === "month" && d.getMonth() !== month;
          return (
            <div key={`day-${key}`} className={styles.calDayRow} style={{ gridColumn: i + 1, gridRow: 1 }}>
              <span className={`${styles.calDay} ${outside ? styles.calDayOutside : ""}`}>
                {effMode === "week" || d.getDate() === 1 ? `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}` : d.getDate()}
              </span>
              {canOpen && !outside && (
                <button className={styles.calAdd} title="Add here" onClick={() => addOn(key)}>+</button>
              )}
            </div>
          );
        })}
        {placed.map((p) => (
          <button
            key={p.ev.id}
            type="button"
            className={`${canOpen ? styles.calEventOpen : styles.calEvent} ${p.before ? styles.calEventBefore : ""} ${p.after ? styles.calEventAfter : ""}`}
            style={{ ...eventStyle(p.ev), gridColumn: `${p.col} / span ${p.span}`, gridRow: p.lane + 2 }}
            title={eventTitle(p.ev)}
            onClick={canOpen ? () => openRow(source, p.ev.id) : undefined}
          >
            {p.ev.title}
          </button>
        ))}
      </div>
    );
  };

  // The picked day's events: the day view, and the list under the phone strip.
  const dayKey = ymd(anchor);
  const showDay = effMode === "day" || isPhone;
  const dayEvents = showDay ? events.filter((e) => e.start <= dayKey && e.end >= dayKey) : [];
  const dayList = showDay && (
    <div className={`${styles.calDayList} ${dayKey === todayStr ? styles.calCellToday : ""}`}>
      {dayEvents.length === 0 && <div className={styles.stub}>Nothing on this day.</div>}
      {dayEvents.map((e) => (
        <button
          key={e.id}
          type="button"
          className={`${canOpen ? styles.calEventOpen : styles.calEvent} ${styles.calDayEvent}`}
          style={eventStyle(e)}
          title={eventTitle(e)}
          onClick={canOpen ? () => openRow(source, e.id) : undefined}
        >
          <span className={styles.calDayEventTitle}>{e.title}</span>
          {e.start !== e.end && <span className={styles.calDayEventSpan}>{e.start} → {e.end}</span>}
        </button>
      ))}
      {canOpen && <button className={styles.calAddDay} onClick={() => addOn(dayKey)}>+ Add here</button>}
    </div>
  );

  return (
    <div className={styles.calendar}>
      <div className={styles.calHeader}>
        <button className={styles.calNav} onClick={() => step(-1)}>‹</button>
        <span className={styles.calTitle}>{title}</span>
        <button className={styles.calNav} onClick={() => step(1)}>›</button>
        <button className={styles.calToday} onClick={goToday}>Today</button>
        {!isPhone && (
          <div className={styles.calModes} role="tablist">
            {CAL_MODES.map((m) => (
              <button key={m.id} role="tab" aria-selected={mode === m.id}
                className={`${styles.calModeBtn} ${mode === m.id ? styles.calModeOn : ""}`} onClick={() => pickMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        )}
        <span className={styles.calField}>by {dateField}{endField ? ` → ${endField}` : ""}</span>
      </div>
      {isPhone ? (
        <>
          <div className={styles.weekStrip} role="tablist" aria-label="Days of the week">
            {Array.from({ length: 7 }, (_, i) => addDays(weekStarts[0], i)).map((d, i) => {
              const key = ymd(d);
              const n = events.filter((e) => e.start <= key && e.end >= key).length;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={key === dayKey}
                  className={`${styles.weekDay} ${key === dayKey ? styles.weekDaySelected : ""} ${key === todayStr ? styles.weekDayToday : ""}`}
                  onClick={() => setAnchor(d)}
                >
                  <span className={styles.weekDayName}>{WEEKDAYS[i]}</span>
                  <span className={styles.weekDayNum}>{d.getDate()}</span>
                  <span className={styles.weekDayCount}>{n > 0 ? n : ""}</span>
                </button>
              );
            })}
          </div>
          {dayList}
        </>
      ) : effMode !== "day" ? (
        <div className={styles.calGrid}>
          <div className={styles.calWeekdays}>
            {WEEKDAYS.map((w) => <div key={w} className={styles.calWeekday}>{w}</div>)}
          </div>
          {weekStarts.map(renderWeek)}
        </div>
      ) : dayList}
      {canOpen && (
        <div className={styles.calFooter}>
          {picking ? (
            <div className={styles.calNewRow}>
              <DatePicker
                value=""
                autoFocus
                placeholder="Day for the new row…"
                inputClassName={styles.cellInput}
                onChange={(d) => { setPicking(false); if (d) addOn(d); }}
                onCancel={() => setPicking(false)}
              />
            </div>
          ) : (
            <button className={styles.newRowBtn} onClick={() => setPicking(true)}>+ New row</button>
          )}
        </div>
      )}
    </div>
  );
}

/** "8 – 14 Sep 2026", or "28 Sep – 4 Oct 2026" across a month edge. */
function weekLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const mon = (d: Date) => MONTHS[d.getMonth()].slice(0, 3);
  if (weekStart.getMonth() === end.getMonth()) return `${weekStart.getDate()} – ${end.getDate()} ${mon(end)} ${end.getFullYear()}`;
  const y = weekStart.getFullYear() === end.getFullYear() ? "" : ` ${weekStart.getFullYear()}`;
  return `${weekStart.getDate()} ${mon(weekStart)}${y} – ${end.getDate()} ${mon(end)} ${end.getFullYear()}`;
}

export function GalleryView({ table, spec, source, onChanged }: {
  table: ViewTable; spec: string; source: string; onChanged: () => void;
}) {
  const canOpen = source.startsWith("collections/");
  const titleField = table.columns.find((c) => c.key === "title") ? "title" : "id";
  // `layout: compact` — a KPI card: no cover, one labelled line per shown
  // property, the first one large. `size:` picks the card width.
  const compact = peek(spec, "layout") === "compact";
  const size = peek(spec, "size");
  // Up to three non-title, non-cover fields shown under the card (every listed one in compact).
  const fieldCols = cardFields(table, spec, [titleField], compact ? 6 : 3);

  const del = (rowId: string) => {
    if (!window.confirm("Delete this row?")) return;
    commands.deleteRow(source, rowId).then(onChanged).catch((e) => window.alert(String(e)));
  };

  if (compact) {
    return (
      <div className={styles.galleryWrap}>
        <div className={`${styles.gallery} ${size === "small" ? styles.gallerySmall : size === "large" ? styles.galleryLarge : ""}`}>
          {table.rows.map((row) => {
            const shown = fieldCols.filter((c) => hasValue(row.cells[c.key]));
            const [big, ...rest] = shown;
            return (
              <div key={row.id} className={`${styles.galleryCard} ${styles.galleryCompact}`}>
                <div className={styles.cardActions}>
                  {canOpen && (
                    <button className={styles.cardOpen} title="Open note" onClick={() => openRow(source, row.id)}>
                      <OpenIcon size={12} />
                    </button>
                  )}
                  <button className={styles.cardDelete} title="Delete row" onClick={() => del(row.id)}>
                    <CloseIcon size={12} />
                  </button>
                </div>
                <div className={styles.galleryBody}>
                  <div
                    className={`${styles.galleryKicker} ${canOpen ? styles.galleryTitleOpen : ""}`}
                    onClick={canOpen ? () => openRow(source, row.id) : undefined}
                  >
                    {formatCell(row.cells[titleField])}
                  </div>
                  {big && (
                    <div className={styles.galleryBig} title={big.key}>
                      {isSelectColumn(big)
                        ? <SelectCell value={row.cells[big.key]} options={big.schema!.options ?? []}
                            multi={big.schema!.type === "multi_select"} editable={false} onChange={() => {}} />
                        : displayCell(big, row.cells[big.key])}
                    </div>
                  )}
                  {rest.map((c) => (
                    <div key={c.key} className={`${styles.galleryField} ${styles.galleryLine}`}>
                      <span className={styles.galleryKey}>{c.key}</span>
                      {isSelectColumn(c)
                        ? <SelectCell value={row.cells[c.key]} options={c.schema!.options ?? []}
                            multi={c.schema!.type === "multi_select"} editable={false} onChange={() => {}} />
                        : <span>{displayCell(c, row.cells[c.key])}</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <button
          className={styles.newRowBtn}
          onClick={() => commands.addRow(source, newRowId(), { title: "Untitled", created: today(), ...seedFromFilter(spec) })
            .then(onChanged).catch((e) => window.alert(String(e)))}
        >
          + New card
        </button>
      </div>
    );
  }

  return (
    <div className={styles.galleryWrap}>
      <div className={`${styles.gallery} ${size === "small" ? styles.gallerySmall : size === "large" ? styles.galleryLarge : ""}`}>
        {table.rows.map((row) => (
          <div key={row.id} className={styles.galleryCard}>
            <div className={styles.cardActions}>
              {canOpen && (
                <button className={styles.cardOpen} title="Open note" onClick={() => openRow(source, row.id)}>
                  <OpenIcon size={12} />
                </button>
              )}
              <button className={styles.cardDelete} title="Delete row" onClick={() => del(row.id)}>
                <CloseIcon size={12} />
              </button>
            </div>
            <div
              className={`${styles.galleryCover} ${canOpen ? styles.galleryCoverOpen : ""}`}
              onClick={canOpen ? () => openRow(source, row.id) : undefined}
            >
              {row.cells["cover"]
                ? <AssetImg value={row.cells["cover"]} className={styles.galleryImg} />
                : <span className={styles.galleryNoCover}>{formatCell(row.cells["title"])?.slice(0, 1) || "—"}</span>}
            </div>
            <div className={styles.galleryBody}>
              <div
                className={canOpen ? styles.galleryTitleOpen : styles.galleryTitle}
                onClick={canOpen ? () => openRow(source, row.id) : undefined}
              >
                {formatCell(row.cells[titleField])}
              </div>
              {fieldCols.filter((c) => hasValue(row.cells[c.key])).map((c) => (
                <div key={c.key} className={styles.galleryField}>
                  {isSelectColumn(c)
                    ? <SelectCell value={row.cells[c.key]} options={c.schema!.options ?? []}
                        multi={c.schema!.type === "multi_select"} editable={false} onChange={() => {}} />
                    : <span><span className={styles.galleryKey}>{c.key}</span>{displayCell(c, row.cells[c.key])}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        className={styles.newRowBtn}
        onClick={() => commands.addRow(source, newRowId(), { title: "Untitled", created: today(), ...seedFromFilter(spec) })
          .then(onChanged).catch((e) => window.alert(String(e)))}
      >
        + New card
      </button>
    </div>
  );
}

/** One line per row: the title, up to three property chips, the row menu. No
 *  header, no cells to edit — the reading view of a collection. */
export function ListView({ table, spec, source, onChanged, onFind }: {
  table: ViewTable; spec: string; source: string; onChanged: () => void;
  /** mod+f while the list has focus: hand focus to the toolbar's search box. */
  onFind?: () => void;
}) {
  const canOpen = source.startsWith("collections/");
  const schemaKey = collectionKey(source);
  const titleField = table.columns.find((c) => c.key === "title") ? "title" : "id";
  // Three chips at most, whatever `columns:` lists — a line stays a line.
  const fieldCols = cardFields(table, spec, [titleField], 3).slice(0, 3);
  const [menuRow, setMenuRow] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [templatesVersion, setTemplatesVersion] = useState(0);
  // `group:` sections — the engine's, newest bucket first when `bucket:` folds a date.
  const groupField = peek(spec, "group");
  const groupCol = groupField ? table.columns.find((c) => c.key === groupField) : undefined;
  const sections = useMemo(() => (groupField ? groupSections(table, groupField, groupCol) : null), [table, groupField, groupCol]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleGroup = (g: string) =>
    setCollapsed((prev) => { const next = new Set(prev); if (next.has(g)) next.delete(g); else next.add(g); return next; });

  const del = (rowId: string) => {
    if (!window.confirm("Delete this row?")) return;
    commands.deleteRow(source, rowId).then(onChanged).catch((e) => setErr(String(e)));
  };
  const duplicate = (rowId: string) =>
    commands.duplicateRow(source, rowId, newRowId(), today()).then(onChanged).catch((e) => setErr(String(e)));
  const saveAsTemplate = (rowId: string) => {
    const name = window.prompt("Template name")?.trim();
    if (!name) return;
    commands.saveRowAsTemplate(source, rowId, name)
      .then(() => setTemplatesVersion((v) => v + 1))
      .catch((e) => setErr(String(e)));
  };

  const renderRow = (row: ViewTable["rows"][number]) => (
        <div key={row.id} className={styles.listRow}>
          {canOpen ? (
            <button type="button" className={styles.listTitleOpen} title="Open note" onClick={() => openRow(source, row.id)}>
              {formatCell(row.cells[titleField])}
            </button>
          ) : (
            <span className={styles.listTitle}>{formatCell(row.cells[titleField])}</span>
          )}
          <span className={styles.listChips}>
            {fieldCols.filter((c) => hasValue(row.cells[c.key])).map((c) => (
              isSelectColumn(c)
                ? <span key={c.key} className={styles.listPills}>
                    <SelectCell value={row.cells[c.key]} options={c.schema!.options ?? []}
                      multi={c.schema!.type === "multi_select"} editable={false} onChange={() => {}} />
                  </span>
                : <span key={c.key} className={styles.listChip} title={c.key}>
                    <span className={styles.listChipKey}>{c.key}</span>{displayCell(c, row.cells[c.key])}
                  </span>
            ))}
          </span>
          <div className={styles.rowActions}>
            {canOpen && (
              <button className={styles.rowOpen} title="Open note" tabIndex={-1} onClick={() => openRow(source, row.id)}>
                <OpenIcon size={13} />
              </button>
            )}
            <RowMenu
              open={menuRow === row.id}
              onToggle={() => setMenuRow((m) => (m === row.id ? null : row.id))}
              items={[
                ...(canOpen ? [{ label: "Open", run: () => openRow(source, row.id) }] : []),
                { label: "Duplicate", run: () => duplicate(row.id) },
                ...(schemaKey ? [{ label: "Save as template…", run: () => saveAsTemplate(row.id) }] : []),
                { label: "Delete", run: () => del(row.id), danger: true },
              ]}
            />
          </div>
        </div>
  );

  return (
    <div className={styles.list} data-find-scope={onFind ? "" : undefined} onKeyDown={(e) => { findKey(e, onFind); }}>
      {!sections && table.rows.map(renderRow)}
      {sections && sections.map((s) => {
        const folded = collapsed.has(s.key);
        const summary = groupSummaryText(table.columns, table.summaryFunctions, s.summary);
        return (
          <div key={s.key} className={styles.listGroup}>
            <button className={styles.groupToggle} onClick={() => toggleGroup(s.key)} aria-expanded={!folded}>
              <span className={`${styles.groupChevron} ${folded ? styles.groupChevronFolded : ""}`}>▾</span>
              <span className={styles.groupTitle}>{s.key === "—" ? `No ${groupField}` : s.label}</span>
              <span className={styles.groupCount}>{s.rows.length}</span>
              {summary && <span className={styles.groupSummaryInline}>{summary}</span>}
            </button>
            {!folded && s.rows.map(renderRow)}
          </div>
        );
      })}
      <div className={styles.footer}>
        <NewRowButton source={source} spec={spec} onChanged={onChanged} onError={setErr} templatesVersion={templatesVersion} />
        <span className={styles.count}>
          {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
          {sections && ` · ${sections.length} group${sections.length === 1 ? "" : "s"}`}
          {err && <span className={styles.error}> · {err}</span>}
        </span>
      </div>
    </div>
  );
}

// ── View configuration helpers — keep the YAML spec out of the user's face ────

/** Set a top-level `key: value` in a spec, replacing the line or appending it. */
function specSet(spec: string, key: string, value: string): string {
  const lines = spec.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  let found = false;
  const out = lines.map((l) => {
    if (l.replace(/\s/g, "").startsWith(`${key}:`)) { found = true; return `${key}: ${value}`; }
    return l;
  });
  if (!found) out.push(`${key}: ${value}`);
  return out.join("\n") + "\n";
}

/** Remove a top-level `key:` line from a spec. */
function specRemove(spec: string, key: string): string {
  const out = spec.split("\n").filter((l) => l.trim() !== "" && !l.replace(/\s/g, "").startsWith(`${key}:`));
  return out.length ? out.join("\n") + "\n" : "";
}

/** Best default group field for a board: a select/status column, else the first
 *  non-title property. */
function pickGroupField(table: ViewTable | null): string {
  const cols = table?.columns ?? [];
  const sel = cols.find((c) => isSelectColumn(c));
  if (sel) return sel.key;
  const other = cols.find((c) => !["title", "id", "$body", "created"].includes(c.key));
  return other?.key ?? "status";
}

/** Switch a view's type, pre-filling the config that type needs so it never
 *  lands in an error state. */
function specWithType(spec: string, newType: string, table: ViewTable | null): string {
  let s = specSet(spec, "type", newType);
  if (newType === "board" && !peek(s, "group")) s = specSet(s, "group", pickGroupField(table));
  if (newType === "chart" && !peek(s, "chartType")) s = specSet(s, "chartType", "line");
  if (newType === "stats" && !peek(s, "stats")) s = specSet(s, "stats", DEFAULT_STATS);
  if (newType === "tracker" && !peek(s, "range")) s = specSet(s, "range", "week");
  return s;
}

function sourceLabel(source: string): string {
  return collectionKey(source) ?? source.replace(/^data\//, "").replace(/\.csv$/, "");
}

const VIEW_TYPE_OPTIONS: { type: string; label: string; render: (s: number) => ReactNode }[] = [
  { type: "table", label: "Table", render: (s) => <TableIcon size={s} /> },
  { type: "board", label: "Board", render: (s) => <BoardIcon size={s} /> },
  { type: "calendar", label: "Calendar", render: (s) => <CalendarIcon size={s} /> },
  { type: "gallery", label: "Gallery", render: (s) => <GalleryIcon size={s} /> },
  { type: "list", label: "List", render: (s) => <ListIcon size={s} /> },
  { type: "chart", label: "Chart", render: (s) => <ChartIcon size={s} /> },
  { type: "stats", label: "Stats", render: (s) => <StatsIcon size={s} /> },
  { type: "tracker", label: "Tracker", render: (s) => <TrackerIcon size={s} /> },
  { type: "timeline", label: "Timeline", render: (s) => <TimelineIcon size={s} /> },
];

/** A dropdown to pick the view type — current type shown, the rest tucked away
 *  in a menu (no `type:` editing, no wall of icons). */
function ViewTypeSwitcher({ current, onChange }: { current: string; onChange: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const active = VIEW_TYPE_OPTIONS.find((o) => o.type === current) ?? VIEW_TYPE_OPTIONS[0];
  return (
    <div className={styles.viewType} ref={ref}>
      <button className={styles.viewTypeBtn} onClick={() => setOpen((o) => !o)} title="Change view type">
        {active.render(15)}
        <span className={styles.viewTypeLabel}>{active.label}</span>
        <span className={styles.viewTypeCaret}>▾</span>
      </button>
      {open && (
        <div className={styles.viewTypeMenu}>
          {VIEW_TYPE_OPTIONS.map((o) => (
            <button
              key={o.type}
              className={`${styles.viewTypeItem} ${o.type === current ? styles.viewTypeItemActive : ""}`}
              onClick={() => { setOpen(false); if (o.type !== current) onChange(o.type); }}
            >
              {o.render(15)} <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Friendly "this board needs a group" state — pick a property, no YAML. */
export function BoardSetup({ table, onPick }: { table: ViewTable | null; onPick: (field: string) => void }) {
  const fields = (table?.columns ?? []).filter((c) => c.key !== "$body" && c.key !== "id");
  return (
    <div className={styles.setup}>
      <BoardIcon size={22} />
      <div className={styles.setupTitle}>Group cards by a property</div>
      {fields.length === 0
        ? <div className={styles.setupHint}>Add a property (like a Status) to this collection first.</div>
        : (
          <div className={styles.setupChips}>
            {fields.map((c) => (
              <button key={c.key} className={styles.setupChip} onClick={() => onPick(c.key)}>{c.key}</button>
            ))}
          </div>
        )}
    </div>
  );
}

const CHART_AGGS = ["", "sum", "avg", "count", "min", "max"];
const CHART_BUCKETS = ["", "day", "week", "month", "quarter", "year"];
/** The chart types the engine draws (`cortex_core::data::CHART_TYPES`). */
export const CHART_TYPES = ["line", "bar", "area", "donut", "pie"];
export const CHART_LABELS = ["name", "value", "name_value", "none"];
export const CHART_HEIGHTS = ["small", "medium", "large"];

/** Inline chart configuration, so charts never need raw spec editing. */
function ChartConfig({ spec, onChange }: { spec: string; onChange: (spec: string) => void }) {
  const [x, setX] = useState(peek(spec, "x") ?? "");
  const [y, setY] = useState(peek(spec, "y") ?? "");
  const agg = peek(spec, "agg") ?? "";
  const ct = peek(spec, "chartType") ?? "line";
  const commit = (key: string, value: string) =>
    onChange(value ? specSet(spec, key, value) : specRemove(spec, key));
  return (
    <div className={styles.chartConfig}>
      <label className={styles.chartField}>X
        <input className={styles.chartInput} value={x} placeholder="date field"
          onChange={(e) => setX(e.target.value)} onBlur={() => commit("x", x.trim())} />
      </label>
      <label className={styles.chartField}>Y
        <input className={styles.chartInput} value={y} placeholder="number field"
          onChange={(e) => setY(e.target.value)} onBlur={() => commit("y", y.trim())} />
      </label>
      <label className={styles.chartField}>Aggregate
        <Dropdown
          value={agg}
          options={CHART_AGGS.map((a) => ({ value: a, label: a || "none" }))}
          onChange={(v) => commit("agg", v)}
        />
      </label>
      <label className={styles.chartField}>Type
        <Dropdown
          value={ct}
          options={CHART_TYPES.map((t) => ({ value: t, label: t }))}
          onChange={(v) => commit("chartType", v)}
        />
      </label>
      <label className={styles.chartField}>By
        <Dropdown
          value={peek(spec, "bucket") ?? ""}
          options={CHART_BUCKETS.map((b) => ({ value: b, label: b || "exact x" }))}
          onChange={(v) => commit("bucket", v)}
        />
      </label>
      <label className={styles.chartField}>Series
        <input className={styles.chartInput} defaultValue={peek(spec, "series") ?? ""} placeholder="field (one line each)"
          onBlur={(e) => commit("series", e.target.value.trim())} />
      </label>
      {(ct === "bar" || ct === "area") && (
        <label className={styles.chartField}>Stack
          <Dropdown
            value={peek(spec, "stack") === "true" ? "true" : ""}
            options={[{ value: "", label: "no" }, { value: "true", label: "yes" }]}
            onChange={(v) => commit("stack", v)}
          />
        </label>
      )}
      {(ct === "donut" || ct === "pie") && (
        <label className={styles.chartField}>Labels
          <Dropdown
            value={peek(spec, "labels") ?? "name"}
            options={CHART_LABELS.map((l) => ({ value: l, label: l.replace("_", " + ") }))}
            onChange={(v) => commit("labels", v === "name" ? "" : v)}
          />
        </label>
      )}
      <label className={styles.chartField}>Legend
        <Dropdown
          value={peek(spec, "legend") === "false" ? "false" : ""}
          options={[{ value: "", label: "shown" }, { value: "false", label: "hidden" }]}
          onChange={(v) => commit("legend", v)}
        />
      </label>
      <label className={styles.chartField}>Height
        <Dropdown
          value={peek(spec, "height") ?? "medium"}
          options={CHART_HEIGHTS.map((h) => ({ value: h, label: h }))}
          onChange={(v) => commit("height", v === "medium" ? "" : v)}
        />
      </label>
    </div>
  );
}

function CortexView({ block, editor }: { block: any; editor: any }) {
  const spec = String(block.props.spec ?? "");
  const lang = String(block.props.lang ?? "cortex-view");
  const declaredType = peek(spec, "type") ?? (lang === "cortex-chart" ? "chart" : "table");
  const source = peek(spec, "source") ?? "—";

  const isChart = declaredType === "chart" || lang === "cortex-chart";
  const isBoard = declaredType === "board";
  const isCalendar = declaredType === "calendar";
  const isGallery = declaredType === "gallery";
  const isList = declaredType === "list";
  const isTracker = declaredType === "tracker";
  const isTimeline = declaredType === "timeline";
  const isStats = declaredType === "stats";

  const [table, setTable] = useState<ViewTable | null>(null);
  const [stats, setStats] = useState<StatsResult | null>(null);
  // The toolbar's search: narrows the rows on show, client-side, never written.
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = () => searchRef.current?.focus();
  const shown = useMemo(() => (table ? searchRows(table, search) : null), [table, search]);
  const [chart, setChart] = useState<ChartResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(spec);

  const needsGroup = isBoard && !peek(spec, "group");
  const needsChartFields = isChart && (!peek(spec, "x") || !peek(spec, "y"));

  const reload = useCallback(() => {
    // A chart with no X/Y would error — wait for the inline config instead.
    if (isChart && (!peek(spec, "x") || !peek(spec, "y"))) {
      setChart(null);
      setError(null);
      return Promise.resolve();
    }
    // The tracker loads its own data (two collections, computed streaks).
    if (isTracker) { setTable(null); setChart(null); setError(null); return Promise.resolve(); }
    setLoading(true);
    setError(null);
    const p = isChart
      ? commands.runChart(spec).then((c) => { setChart(c); setTable(null); setStats(null); })
      : isStats
        ? commands.runStats(spec).then((s) => { setStats(s); setTable(null); setChart(null); })
        : commands.runView(spec).then((t) => { setTable(t); setChart(null); setStats(null); });
    return p
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [spec, isChart, isStats, isTracker]);

  useEffect(() => { reload(); }, [reload]);

  const applySpec = (next: string) => editor.updateBlock(block, { props: { spec: next, lang } });

  // Re-run the query when a sync pulls teammate changes (Shell dispatches this).
  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener("cortex:data-changed", onChanged);
    return () => window.removeEventListener("cortex:data-changed", onChanged);
  }, [reload]);

  return (
    <div className={styles.card} contentEditable={false}>
      <div className={styles.header}>
        <ViewTypeSwitcher current={declaredType} onChange={(t) => applySpec(specWithType(spec, t, table))} />
        <span className={styles.sourceLabel}>{sourceLabel(source)}</span>
        <button
          className={styles.editBtn}
          title="Edit the raw spec (advanced)"
          onClick={() => { setDraft(spec); setEditing((x) => !x); }}
        >
          {editing ? "Close" : "Edit"}
        </button>
      </div>

      {editing && (
        <div className={styles.editor}>
          <textarea
            className={styles.specInput}
            value={draft}
            spellCheck={false}
            rows={Math.max(4, draft.split("\n").length)}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className={styles.editActions}>
            <button className={styles.saveBtn} onClick={() => { applySpec(draft); setEditing(false); }}>Save</button>
            <button className={styles.cancelBtn} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Per-type controls: table/board/calendar/gallery get the filter toolbar;
          charts get the inline X/Y config. */}
      {!editing && isChart && <ChartConfig spec={spec} onChange={applySpec} />}
      {!editing && isTracker && (
        <TrackerView
          spec={spec}
          source={source}
          onRangeChange={(r) => applySpec(specSet(spec, "range", r))}
          onLogChange={(l) => applySpec(specSet(spec, "log", l))}
        />
      )}
      {!editing && !isChart && !isTracker && !isStats && !needsGroup && (
        <ViewToolbar
          spec={spec}
          fields={table?.allColumns ?? []}
          visibleColumns={table?.columns.map((c) => c.key).filter((k) => k !== "$body") ?? []}
          isBoard={isBoard}
          isTable={declaredType === "table"}
          onSpecChange={applySpec}
          search={search}
          onSearchChange={setSearch}
          searchRef={searchRef}
        />
      )}

      {/* Friendly setup states replace cryptic spec errors. */}
      {!editing && needsGroup && (
        <BoardSetup table={table} onPick={(f) => applySpec(specSet(spec, "group", f))} />
      )}
      {!editing && needsChartFields && (
        <div className={styles.stub}>Set the X and Y fields above to draw the chart.</div>
      )}

      {!editing && error && (missingCollection(error)
        ? <MissingCollection name={missingCollection(error)!} />
        : <div className={styles.errorSoft}>{error}</div>)}

      {/* Keep the last-loaded data mounted across a refresh so add/remove/drag
          update in place instead of flashing a "Loading…" stub. */}
      {!editing && !error && isStats && (stats ? <StatsView stats={stats} /> : loading ? <div className={styles.stub}>Loading…</div> : null)}
      {!editing && !error && !needsGroup && !needsChartFields && !isTracker && !isStats && (isChart
        ? (chart
            ? (chart.points.length === 0
                ? <div className={styles.stub}>No data points yet.</div>
                : <MiniChart chart={chart} />)
            : loading ? <div className={styles.stub}>Loading…</div> : null)
        : (table && shown
            ? (table.rows.length === 0 && !isCalendar
                ? <div className={styles.stub}>Nothing here yet — add a row below.</div>
                : shown.rows.length === 0 && !isCalendar
                  ? <div className={styles.stub}>No rows match “{search.trim()}”.</div>
                : isBoard
                  ? <BoardView table={shown} spec={spec} source={source} onChanged={reload} />
                  : isCalendar
                    ? <CalendarView table={shown} spec={spec} source={source} onChanged={reload} onModeChange={(m) => applySpec(specSet(spec, "mode", m))} />
                    : isGallery
                      ? <GalleryView table={shown} spec={spec} source={source} onChanged={reload} />
                      : isList
                        ? <ListView table={shown} spec={spec} source={source} onChanged={reload} onFind={focusSearch} />
                      : isTimeline
                        ? <TimelineView table={shown} spec={spec} source={source} onStartChange={(f) => applySpec(specSet(spec, "start", f))} />
                        : <DataTable table={shown} spec={spec} source={source} onChanged={reload} onSpecChange={applySpec} onFind={focusSearch} />)
            : loading ? <div className={styles.stub}>Loading…</div> : null))}
    </div>
  );
}

/** The collection named by a "Collection not found: x" error, else null. A
 *  pack's row template may embed another pack's collection that isn't here. */
export function missingCollection(err: string | null): string | null {
  const m = err?.match(/Collection not found:?\s*["'`]?([^"'`\s]+)/);
  return m ? m[1] : null;
}

/** Quiet stand-in for a view over a collection that isn't installed. */
export function MissingCollection({ name }: { name: string }) {
  return (
    <div className={styles.stub}>
      <div>Collection "{name}" is not installed here.</div>
      <div className={styles.stubSub}>Install a pack that provides it, or remove this block.</div>
    </div>
  );
}

export const cortexViewSpec = createReactBlockSpec(
  {
    type: "cortexView",
    propSchema: {
      spec: { default: "" },
      lang: { default: "cortex-view" },
    },
    content: "none",
  },
  {
    render: (props) => <CortexView block={props.block} editor={props.editor} />,
  },
)();

/** Editor schema = all default blocks + our in-memory view block. */

/** Slash-menu items that insert a starter data block at the cursor. */
export function cortexSlashItems(editor: any): DefaultReactSuggestionItem[] {
  const insert = (spec: string, lang: string) =>
    insertOrUpdateBlockForSlashMenu(editor, { type: "cortexView", props: { spec, lang } } as never);
  return [
    {
      title: "Data view",
      subtext: "Filtered table from a collection or CSV",
      aliases: ["table", "view", "data", "cortex"],
      group: "Data",
      onItemClick: () => insert(STARTER_VIEW_SPEC, "cortex-view"),
    },
    {
      title: "Board",
      subtext: "Group rows into columns by a field",
      aliases: ["board", "kanban", "group"],
      group: "Data",
      onItemClick: () => insert(STARTER_BOARD_SPEC, "cortex-view"),
    },
    {
      title: "Calendar",
      subtext: "Rows on a month, week or day grid by a date field",
      aliases: ["calendar", "month", "week", "day", "schedule", "date"],
      group: "Data",
      onItemClick: () => insert(STARTER_CALENDAR_SPEC, "cortex-view"),
    },
    {
      title: "Gallery",
      subtext: "Cards with cover images from a collection",
      aliases: ["gallery", "cards", "grid", "cover"],
      group: "Data",
      onItemClick: () => insert(STARTER_GALLERY_SPEC, "cortex-view"),
    },
    {
      title: "List",
      subtext: "One line per row: title and a few properties",
      aliases: ["list", "rows", "compact"],
      group: "Data",
      onItemClick: () => insert(STARTER_LIST_SPEC, "cortex-view"),
    },
    {
      title: "Chart",
      subtext: "Line or bar chart from a CSV",
      aliases: ["chart", "graph", "plot"],
      group: "Data",
      onItemClick: () => insert(STARTER_CHART_SPEC, "cortex-chart"),
    },
    {
      title: "Tracker",
      subtext: "Habits × days with streaks, from a collection and its daily log",
      aliases: ["tracker", "habit", "habits", "streak", "heatmap"],
      group: "Data",
      onItemClick: () => insert(STARTER_TRACKER_SPEC, "cortex-view"),
    },
    {
      title: "Timeline",
      subtext: "Bars from a start date to an end date on a week axis",
      aliases: ["timeline", "gantt", "roadmap", "schedule"],
      group: "Data",
      onItemClick: () => insert(STARTER_TIMELINE_SPEC, "cortex-view"),
    },
  ];
}

// ── Boundary translation (block-level, deterministic) ─────────────────────────

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : ""))
    .join("");
}

/** Markdown → blocks: turn `cortex-view`/`cortex-chart` code blocks into live view blocks. */
export function inflateViewBlocks(blocks: any[]): any[] {
  return blocks.map((b) => {
    if (b?.type === "codeBlock" && VIEW_LANGUAGES.includes(b?.props?.language)) {
      return {
        type: "cortexView",
        props: { spec: inlineText(b.content), lang: b.props.language },
      };
    }
    if (Array.isArray(b?.children) && b.children.length) {
      return { ...b, children: inflateViewBlocks(b.children) };
    }
    return b;
  });
}

/** Blocks → markdown: collapse live view blocks back to standard code fences. */
export function flattenViewBlocks(blocks: any[]): any[] {
  // A fence cannot hold children: blocks nested under a view (Tab in the
  // editor) are hoisted after it rather than lost on save.
  return blocks.flatMap((b) => {
    if (b?.type === "cortexView") {
      const fence = {
        type: "codeBlock",
        props: { language: String(b.props?.lang ?? "cortex-view") },
        content: [{ type: "text", text: String(b.props?.spec ?? ""), styles: {} }],
      };
      return [fence, ...flattenViewBlocks(Array.isArray(b.children) ? b.children : [])];
    }
    if (Array.isArray(b?.children) && b.children.length) {
      return [{ ...b, children: flattenViewBlocks(b.children) }];
    }
    return [b];
  });
}

export const SAMPLE_VIEW_SPEC = `source: collections/books
type: table
filter: status == 'reading'
columns: [title, author, rating]`;
