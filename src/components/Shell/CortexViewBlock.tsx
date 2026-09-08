// ── Embeddable data-view block ────────────────────────────────────────────────
// A `cortex-view` / `cortex-chart` fenced code block renders as a live table /
// board / chart inside the editor. On disk it is ALWAYS a standard fenced code
// block (human-readable, git-diffable) — the custom block exists only in memory.
//
// Storage uses the DEFAULT code block (lossless Markdown round-trip via
// blocksToMarkdownLossy / tryParseMarkdownToBlocks). We translate
// codeBlock(language: "cortex-view") <-> our custom block at the load/save
// boundary, so we never depend on BlockNote's lossy custom-block serializer.

import { useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { createReactBlockSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { commands, ViewTable, ViewColumn, PropType, PropertyDef, ChartResult } from "../../lib/commands";
import { CloseIcon, OpenIcon, TableIcon, BoardIcon, CalendarIcon, GalleryIcon, ChartIcon, TrackerIcon, CheckIcon } from "./icons";
import { SelectCell } from "./SelectCell";
import { TrackerView } from "./TrackerView";
import { Dropdown } from "./Dropdown";
import { ViewToolbar } from "./ViewToolbar";
import styles from "./CortexViewBlock.module.css";

/** Select-like columns render as colored pills (incl. person + relation). */
function isSelectColumn(col: ViewColumn): boolean {
  const t = col.schema?.type;
  return t === "select" || t === "status" || t === "multi_select" || t === "person" || t === "relation";
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
];

/** Column header with a Notion-style "property type" menu. Setting a select-like
 *  type creates the schema property, which turns the cells into colored pills. */
function ColumnHeader({ col, canType, onSetType }: {
  col: ViewColumn;
  canType: boolean;
  onSetType: (type: PropType) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!canType) return <span>{col.key}</span>;

  const current = col.schema?.type;
  return (
    <div className={styles.colHeader} ref={ref}>
      <button className={styles.colHeaderBtn} onClick={() => setOpen((o) => !o)} title="Property type">
        {col.key}
      </button>
      {open && (
        <div className={styles.colMenu}>
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
        </div>
      )}
    </div>
  );
}

/** "+" column header → a small form to add a new typed property to the schema. */
// Relation/rollup need extra config the column-header retype menu can't provide,
// so they're only offered when *adding* a property.
const ADD_PROP_TYPES: { value: PropType; label: string }[] = [
  ...COLUMN_TYPES,
  { value: "relation", label: "Relation" },
  { value: "rollup", label: "Rollup" },
];
const ROLLUP_FNS = ["count", "sum", "avg", "min", "max", "values"];

function AddPropertyHeader({ columns, onAdd }: { columns: ViewColumn[]; onAdd: (prop: PropertyDef) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<PropType>("text");
  const [collection, setCollection] = useState("");
  const [relation, setRelation] = useState("");
  const [property, setProperty] = useState("");
  const [fn, setFn] = useState("count");
  const [collections, setCollections] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    commands.listCollections().then(setCollections).catch(() => {});
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const relationCols = columns.filter((c) => c.schema?.type === "relation");

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    if (type === "relation" && !collection) return;
    if (type === "rollup" && (!relation || !fn)) return;
    const prop: PropertyDef = { name: n, type, options: [] };
    if (type === "relation") prop.collection = collection;
    if (type === "rollup") {
      prop.relation = relation;
      prop.function = fn;
      if (fn !== "count" && property.trim()) prop.property = property.trim();
    }
    onAdd(prop);
    setName(""); setType("text"); setCollection(""); setRelation(""); setProperty(""); setFn("count");
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
                value={relation}
                placeholder="Via relation…"
                options={relationCols.map((c) => ({ value: c.key, label: c.key }))}
                onChange={setRelation}
              />
              <Dropdown
                fullWidth
                value={fn}
                options={ROLLUP_FNS.map((f) => ({ value: f, label: f }))}
                onChange={setFn}
              />
              {fn !== "count" && (
                <input
                  className={styles.addPropInput}
                  value={property}
                  placeholder="Property to aggregate"
                  onChange={(e) => setProperty(e.target.value)}
                />
              )}
              {relationCols.length === 0 && <div className={styles.addPropHint}>Add a Relation property first.</div>}
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

function formatCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function fmtNum(n: number): string {
  if (!isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
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

export const STARTER_CHART_SPEC = `source: data/weight.csv
type: chart
chartType: line
x: date
y: weight`;

export const STARTER_TRACKER_SPEC = `source: collections/habits
type: tracker
log: collections/habit-log
range: week`;

/** Series colours: the accent first, then the tag palette — theme tokens, never hex. */
const SERIES_COLORS = ["var(--accent)", "var(--tag-green-fg)", "var(--tag-orange-fg)", "var(--tag-purple-fg)", "var(--tag-pink-fg)", "var(--tag-yellow-fg)", "var(--tag-brown-fg)", "var(--tag-red-fg)", "var(--tag-blue-fg)"];

/** Dependency-free SVG line/bar chart. One series, or several when the spec
 *  sets `series:` (lines overlaid, bars grouped). Responsive via viewBox. */
export function MiniChart({ chart }: { chart: ChartResult }) {
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
  const ticks = [max, (min + max) / 2, min];
  const baseY = yAt(Math.max(0, min));
  const labelEvery = Math.ceil(n / 6);

  return (
    <div className={styles.chartWrap}>
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
  const ys = chart.series.flatMap((s) => s.points.map((p) => p.y));
  let min = Math.min(0, ...ys), max = Math.max(...ys);
  if (min === max) { max = min + 1; }
  const span = max - min; max += span * 0.06;
  const n = xs.length;
  const isBar = chart.chartType === "bar";
  const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => padT + innerH - ((v - min) / (max - min)) * innerH;
  const slot = innerW / Math.max(1, n);
  const bw = Math.max(1, (slot * 0.7) / chart.series.length);
  const ticks = 3;
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  return (
    <div className={styles.chartWrap}>
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
        {chart.series.map((s, si) => {
          const byX = new Map(s.points.map((p) => [p.x, p.y]));
          const color = SERIES_COLORS[si % SERIES_COLORS.length];
          if (isBar) {
            return xs.map((x, i) => {
              const y = byX.get(x) ?? 0;
              const x0 = padL + i * slot + (slot - bw * chart.series.length) / 2 + si * bw;
              return <rect key={`${si}-${x}`} x={x0} y={yAt(y)} width={bw} height={Math.max(0, yAt(min) - yAt(y))} fill={color} opacity={0.9} rx={1} />;
            });
          }
          const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(byX.get(x) ?? 0)}`).join(" ");
          return <path key={si} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />;
        })}
        {xs.map((x, i) => (i % labelEvery === 0 || i === n - 1) && (
          <text key={x} x={isBar ? padL + i * slot + slot / 2 : xAt(i)} y={H - padB + 16} textAnchor="middle" className={styles.axisLabel}>{x}</text>
        ))}
        {chart.series.map((s, si) => (
          <g key={`l${si}`} transform={`translate(${padL + si * 100}, ${H - 14})`}>
            <rect width={10} height={10} rx={2} fill={SERIES_COLORS[si % SERIES_COLORS.length]} />
            <text x={14} y={9} className={styles.axisLabel}>{s.name.length > 12 ? s.name.slice(0, 11) + "…" : s.name}</text>
          </g>
        ))}
      </svg>
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
  return String(v);
}

function EditableCell({ value, editable, saving, onCommit }: {
  value: unknown;
  editable: boolean;
  saving: boolean;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!editable) {
    return <span className={styles.cellReadonly}>{formatCell(value)}</span>;
  }

  if (!editing) {
    return (
      <span
        className={styles.cellEditable}
        title="Click to edit"
        onClick={() => { setDraft(toInput(value)); setEditing(true); }}
      >
        {saving ? "…" : formatCell(value)}
      </span>
    );
  }

  const finish = (save: boolean) => {
    setEditing(false);
    const original = toInput(value);
    if (save && draft !== original) onCommit(draft);
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

export function DataTable({ table, spec, source, onChanged }: { table: ViewTable; spec: string; source: string; onChanged: () => void }) {
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  const schemaKey = collectionKey(source);

  const setColumnType = (col: ViewTable["columns"][number], type: PropType) => {
    if (!schemaKey) return;
    commands.upsertProperty(schemaKey, { name: col.key, type, options: col.schema?.options ?? [] })
      .then(onChanged)
      .catch((e) => setErr(String(e)));
  };

  const renderCell = (c: ViewTable["columns"][number], row: ViewTable["rows"][number]) => {
    // Computed columns — rollups, formulas, the reverse side of a relation — are read-only.
    if (c.schema?.type === "rollup" || c.schema?.type === "formula" || (c.schema?.type === "relation" && c.schema?.from)) {
      return <span className={styles.cellReadonly}>{formatCell(row.cells[c.key])}</span>;
    }
    if (isSelectColumn(c)) {
      const t = c.schema!.type;
      const multi = t === "multi_select" || t === "relation";
      // Person + relation options come from elsewhere (roster / target collection),
      // so they aren't editable inline like a regular select's options.
      const managed = t === "person" || t === "relation";
      return (
        <SelectCell
          value={row.cells[c.key]}
          options={c.schema!.options}
          multi={multi}
          editable={c.key !== "$body" && c.key !== "id"}
          placeholder={t === "person" ? "Unassigned" : t === "relation" ? "Link…" : "Empty"}
          onChange={(next) => {
            const value = Array.isArray(next) ? next.join(", ") : next;
            commit(c, row.id, value, multi ? "list" : "text");
          }}
          onOptionsChange={schemaKey && !managed ? (opts) => {
            commands.upsertProperty(schemaKey, { name: c.key, type: c.schema!.type, options: opts })
              .then(onChanged).catch((e) => setErr(String(e)));
          } : undefined}
        />
      );
    }
    if (c.ty === "bool" || c.schema?.type === "checkbox") {
      return (
        <CheckboxCell
          value={row.cells[c.key]}
          editable={c.key !== "$body" && c.key !== "id"}
          saving={savingKey === `${row.id}:${c.key}`}
          onCommit={(v) => commit(c, row.id, v, "bool")}
        />
      );
    }
    return (
      <EditableCell
        value={row.cells[c.key]}
        editable={c.key !== "$body" && c.key !== "id"}
        saving={savingKey === `${row.id}:${c.key}`}
        onCommit={(v) => commit(c, row.id, v)}
      />
    );
  };

  const canOpen = source.startsWith("collections/");

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c.key}>
                <ColumnHeader
                  col={c}
                  canType={!!schemaKey && c.key !== "id" && c.key !== "$body"}
                  onSetType={(ty) => setColumnType(c, ty)}
                />
              </th>
            ))}
            {schemaKey && (
              <th className={styles.addPropCol}>
                <AddPropertyHeader
                  columns={table.columns}
                  onAdd={(prop) =>
                    commands.upsertProperty(schemaKey, prop)
                      .then(onChanged).catch((e) => setErr(String(e)))}
                />
              </th>
            )}
            <th className={styles.rowActionCol} />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.id}>
              {table.columns.map((c) => (
                <td key={c.key}>{renderCell(c, row)}</td>
              ))}
              {schemaKey && <td className={styles.addPropCol} />}
              <td className={styles.rowActionCol}>
                <div className={styles.rowActions}>
                  {canOpen && (
                    <button className={styles.rowOpen} title="Open note" onClick={() => openRow(source, row.id)}>
                      <OpenIcon size={13} />
                    </button>
                  )}
                  <button className={styles.rowDelete} title="Delete row" onClick={() => del(row.id)}>
                    <CloseIcon size={13} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.footer}>
        <NewRowButton source={source} spec={spec} onChanged={onChanged} onError={setErr} />
        <span className={styles.count}>
          {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
          {err && <span className={styles.error}> · {err}</span>}
        </span>
      </div>
    </div>
  );
}

/** "New row" — a plain button, or a dropdown (Blank / templates / New template)
 *  when the collection has row templates. */
function NewRowButton({ source, spec, onChanged, onError }: {
  source: string; spec: string; onChanged: () => void; onError: (e: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const collection = collectionKey(source);

  const loadTemplates = useCallback(() => {
    if (collection) commands.listRowTemplates(source).then(setTemplates).catch(() => {});
  }, [source, collection]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const seed = () => ({ title: "Untitled", created: today(), ...seedFromFilter(spec) });
  const addBlank = () =>
    commands.addRow(source, newRowId(), seed()).then(onChanged).catch((e) => onError(String(e)));
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
    return <button className={styles.newRowBtn} onClick={addBlank}>+ New row</button>;
  }

  return (
    <div className={styles.newRowWrap} ref={ref}>
      <button className={styles.newRowBtn} onClick={addBlank}>+ New row</button>
      <button className={styles.newRowCaret} title="New from template" onClick={() => setOpen((o) => !o)}>▾</button>
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
  const [dragOver, setDragOver] = useState<string | null>(null);

  const groupField = peek(spec, "group");
  if (!groupField) {
    return <div className={styles.error}>Board view needs a <code>group:</code> field in the spec.</div>;
  }

  const groupCol = table.columns.find((c) => c.key === groupField);

  const groups = new Map<string, ViewTable["rows"]>();
  for (const row of rows) {
    const key = toInput(row.cells[groupField]) || "—";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Column order: the group property's defined options first — so a status board
  // reads in the workflow order you chose, not alphabetically — then any other
  // present values, then the "no value" column. Defined options always appear as
  // a column (even when empty) so they're valid drop targets.
  const optionOrder = groupCol?.schema?.options.map((o) => o.name) ?? [];
  const present = [...groups.keys()];
  const extras = present.filter((p) => p !== "—" && !optionOrder.includes(p)).sort();
  const none = groups.has("—") ? ["—"] : [];
  const groupKeys = [...new Set([...optionOrder, ...extras, ...none])];

  const titleField =
    table.columns.find((c) => c.key === "title")?.key ??
    table.columns.find((c) => c.key !== groupField && c.key !== "$body")?.key ??
    "id";
  const fieldCols = table.columns.filter(
    (c) => c.key !== groupField && c.key !== "$body" && c.key !== titleField && c.key !== "id",
  );

  const addToGroup = (value: string) => {
    const fields: Record<string, string> = {
      title: "Untitled",
      created: today(),
      ...seedFromFilter(spec),
      [groupField]: value === "—" ? "" : value,
    };
    commands.addRow(source, newRowId(), fields).then(onChanged).catch((e) => window.alert(String(e)));
  };

  const del = (rowId: string) => {
    if (!window.confirm("Delete this row?")) return;
    commands.deleteRow(source, rowId).then(onChanged).catch((e) => window.alert(String(e)));
  };

  // Drop a card into a column → write its group field (e.g. status).
  const moveCard = (rowId: string, group: string) => {
    const value = group === "—" ? "" : group;
    const row = rows.find((r) => r.id === rowId);
    if (!row || (toInput(row.cells[groupField]) || "—") === group) return;
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [groupField]: value } } : r)));
    const ty = groupCol?.ty ?? "text";
    commands.setCell(source, rowId, groupField, value, ty)
      .then(onChanged)
      .catch((e) => { window.alert(String(e)); onChanged(); });
  };

  const canOpen = source.startsWith("collections/");

  return (
    <div className={styles.board}>
      {groupKeys.map((g) => (
        <div
          key={g}
          className={`${styles.boardCol} ${dragOver === g ? styles.boardColDragOver : ""}`}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOver !== g) setDragOver(g); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver((d) => (d === g ? null : d)); }}
          onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) moveCard(id, g); }}
        >
          <div className={styles.boardColHeader}>
            <span className={styles.boardColTitle}>{g}</span>
            <span className={styles.boardColCount}>{(groups.get(g) ?? []).length}</span>
          </div>
          <div className={styles.boardCards}>
            {(groups.get(g) ?? []).map((row) => (
              <div
                key={row.id}
                className={styles.boardCard}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("text/plain", row.id); e.dataTransfer.effectAllowed = "move"; }}
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
                {fieldCols.map((c) => (
                  <div key={c.key} className={styles.boardCardField}>
                    <span className={styles.boardCardKey}>{c.key}</span>
                    {isSelectColumn(c) ? (
                      <SelectCell
                        value={row.cells[c.key]}
                        options={c.schema!.options}
                        multi={c.schema!.type === "multi_select"}
                        editable={false}
                        onChange={() => {}}
                      />
                    ) : (
                      <span>{formatCell(row.cells[c.key])}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button className={styles.boardAdd} onClick={() => addToGroup(g)}>+ Add</button>
        </div>
      ))}
    </div>
  );
}

/** Resolve a cover value (vault path / data URI / URL) to a displayable src. */
function AssetImg({ value, className }: { value: unknown; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const raw = typeof value === "string" ? value : "";
  useEffect(() => {
    let alive = true;
    if (!raw) { setSrc(null); return; }
    if (raw.startsWith("data:") || raw.startsWith("http")) { setSrc(raw); return; }
    commands.readAsset(raw).then((d) => { if (alive) setSrc(d); }).catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [raw]);
  if (!src) return null;
  return <img src={src} className={className} alt="" />;
}

/** Pick the date field for a calendar: explicit `date:`, else a date column,
 *  else a conventional fallback. */
function dateFieldFor(table: ViewTable, spec: string): string {
  const declared = peek(spec, "date");
  if (declared) return declared;
  const dateCol = table.columns.find((c) => c.ty === "date" && c.key !== "$body");
  if (dateCol) return dateCol.key;
  for (const k of ["date", "created", "due"]) {
    if (table.columns.some((c) => c.key === k)) return k;
  }
  return "created";
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CalendarView({ table, spec, source, onChanged }: {
  table: ViewTable; spec: string; source: string; onChanged: () => void;
}) {
  const dateField = dateFieldFor(table, spec);
  const canOpen = source.startsWith("collections/");

  // Group rows by their YYYY-MM-DD date. Non-date / unparseable rows are skipped.
  const byDay = new Map<string, ViewTable["rows"]>();
  for (const row of table.rows) {
    const v = row.cells[dateField];
    const key = typeof v === "string" ? v.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(row);
  }

  // Default to the month holding the most rows, else today.
  const monthTally = new Map<string, number>();
  for (const k of byDay.keys()) monthTally.set(k.slice(0, 7), (monthTally.get(k.slice(0, 7)) ?? 0) + byDay.get(k)!.length);
  const busiest = [...monthTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const initial = busiest ? new Date(`${busiest}-01T00:00:00`) : new Date();
  const [view, setView] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));

  const year = view.getFullYear();
  const month = view.getMonth();
  // Monday-first grid. JS getDay(): 0=Sun..6=Sat → shift so Mon=0.
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr = ymd(new Date());
  const addOn = (day: string) =>
    commands.addRow(source, newRowId(), { title: "Untitled", created: today(), ...seedFromFilter(spec), [dateField]: day })
      .then(onChanged).catch((e) => window.alert(String(e)));

  return (
    <div className={styles.calendar}>
      <div className={styles.calHeader}>
        <button className={styles.calNav} onClick={() => setView(new Date(year, month - 1, 1))}>‹</button>
        <span className={styles.calTitle}>{MONTHS[month]} {year}</span>
        <button className={styles.calNav} onClick={() => setView(new Date(year, month + 1, 1))}>›</button>
        <button className={styles.calToday} onClick={() => { const n = new Date(); setView(new Date(n.getFullYear(), n.getMonth(), 1)); }}>Today</button>
        <span className={styles.calField}>by {dateField}</span>
      </div>
      <div className={styles.calGrid}>
        {WEEKDAYS.map((w) => <div key={w} className={styles.calWeekday}>{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} className={styles.calEmpty} />;
          const key = ymd(d);
          const rows = byDay.get(key) ?? [];
          return (
            <div key={i} className={`${styles.calCell} ${key === todayStr ? styles.calCellToday : ""}`}>
              <div className={styles.calDayRow}>
                <span className={styles.calDay}>{d.getDate()}</span>
                {canOpen && (
                  <button className={styles.calAdd} title="Add here" onClick={() => addOn(key)}>+</button>
                )}
              </div>
              {rows.map((row) => (
                <div
                  key={row.id}
                  className={canOpen ? styles.calEventOpen : styles.calEvent}
                  title={formatCell(row.cells["title"] ?? row.id)}
                  onClick={canOpen ? () => openRow(source, row.id) : undefined}
                >
                  {formatCell(row.cells["title"] ?? row.id)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GalleryView({ table, spec, source, onChanged }: {
  table: ViewTable; spec: string; source: string; onChanged: () => void;
}) {
  const canOpen = source.startsWith("collections/");
  const titleField = table.columns.find((c) => c.key === "title") ? "title" : "id";
  // Up to three non-title, non-cover fields shown under the card.
  const fieldCols = table.columns
    .filter((c) => !["$body", "id", "cover", titleField].includes(c.key))
    .slice(0, 3);

  const del = (rowId: string) => {
    if (!window.confirm("Delete this row?")) return;
    commands.deleteRow(source, rowId).then(onChanged).catch((e) => window.alert(String(e)));
  };

  return (
    <div className={styles.galleryWrap}>
      <div className={styles.gallery}>
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
              {fieldCols.map((c) => (
                <div key={c.key} className={styles.galleryField}>
                  {isSelectColumn(c)
                    ? <SelectCell value={row.cells[c.key]} options={c.schema!.options}
                        multi={c.schema!.type === "multi_select"} editable={false} onChange={() => {}} />
                    : <span>{formatCell(row.cells[c.key])}</span>}
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
  { type: "chart", label: "Chart", render: (s) => <ChartIcon size={s} /> },
  { type: "tracker", label: "Tracker", render: (s) => <TrackerIcon size={s} /> },
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
const CHART_BUCKETS = ["", "day", "week", "month", "year"];

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
          options={[{ value: "line", label: "line" }, { value: "bar", label: "bar" }]}
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
  const isTracker = declaredType === "tracker";

  const [table, setTable] = useState<ViewTable | null>(null);
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
      ? commands.runChart(spec).then((c) => { setChart(c); setTable(null); })
      : commands.runView(spec).then((t) => { setTable(t); setChart(null); });
    return p
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [spec, isChart, isTracker]);

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
      {!editing && !isChart && !isTracker && !needsGroup && (
        <ViewToolbar
          spec={spec}
          fields={table?.allColumns ?? []}
          visibleColumns={table?.columns.map((c) => c.key).filter((k) => k !== "$body") ?? []}
          isBoard={isBoard}
          onSpecChange={applySpec}
        />
      )}

      {/* Friendly setup states replace cryptic spec errors. */}
      {!editing && needsGroup && (
        <BoardSetup table={table} onPick={(f) => applySpec(specSet(spec, "group", f))} />
      )}
      {!editing && needsChartFields && (
        <div className={styles.stub}>Set the X and Y fields above to draw the chart.</div>
      )}

      {!editing && error && <div className={styles.errorSoft}>{error}</div>}

      {/* Keep the last-loaded data mounted across a refresh so add/remove/drag
          update in place instead of flashing a "Loading…" stub. */}
      {!editing && !error && !needsGroup && !needsChartFields && !isTracker && (isChart
        ? (chart
            ? (chart.points.length === 0
                ? <div className={styles.stub}>No data points yet.</div>
                : <MiniChart chart={chart} />)
            : loading ? <div className={styles.stub}>Loading…</div> : null)
        : (table
            ? (table.rows.length === 0 && !isCalendar
                ? <div className={styles.stub}>Nothing here yet — add a row below.</div>
                : isBoard
                  ? <BoardView table={table} spec={spec} source={source} onChanged={reload} />
                  : isCalendar
                    ? <CalendarView table={table} spec={spec} source={source} onChanged={reload} />
                    : isGallery
                      ? <GalleryView table={table} spec={spec} source={source} onChanged={reload} />
                      : <DataTable table={table} spec={spec} source={source} onChanged={reload} />)
            : loading ? <div className={styles.stub}>Loading…</div> : null))}
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
      subtext: "Place rows on a month grid by a date field",
      aliases: ["calendar", "month", "schedule", "date"],
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
  return blocks.map((b) => {
    if (b?.type === "cortexView") {
      return {
        type: "codeBlock",
        props: { language: String(b.props?.lang ?? "cortex-view") },
        content: [{ type: "text", text: String(b.props?.spec ?? ""), styles: {} }],
      };
    }
    if (Array.isArray(b?.children) && b.children.length) {
      return { ...b, children: flattenViewBlocks(b.children) };
    }
    return b;
  });
}

export const SAMPLE_VIEW_SPEC = `source: collections/books
type: table
filter: status == 'reading'
columns: [title, author, rating]`;
