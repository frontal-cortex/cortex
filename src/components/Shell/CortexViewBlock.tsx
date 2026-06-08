// ── Embeddable data-view block ────────────────────────────────────────────────
// A `cortex-view` / `cortex-chart` fenced code block renders as a live table /
// board / chart inside the editor. On disk it is ALWAYS a standard fenced code
// block (human-readable, git-diffable) — the custom block exists only in memory.
//
// Storage uses the DEFAULT code block (lossless Markdown round-trip via
// blocksToMarkdownLossy / tryParseMarkdownToBlocks). We translate
// codeBlock(language: "cortex-view") <-> our custom block at the load/save
// boundary, so we never depend on BlockNote's lossy custom-block serializer.

import { useState, useEffect, useCallback, useRef } from "react";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { createReactBlockSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { commands, ViewTable, ViewColumn, PropType, ChartResult } from "../../lib/commands";
import { CloseIcon, OpenIcon } from "./icons";
import { SelectCell } from "./SelectCell";
import { ViewToolbar } from "./ViewToolbar";
import { noteEmbedSpec } from "./NoteEmbedBlock";
import { calloutSpec } from "./CalloutBlock";
import styles from "./CortexViewBlock.module.css";

/** A select/status/multi-select column renders as colored pills, not a text box. */
function isSelectColumn(col: ViewColumn): boolean {
  const t = col.schema?.type;
  return t === "select" || t === "status" || t === "multi_select";
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function newRowId(): string {
  return `row-${Date.now().toString(36)}`;
}

// A new row in a filtered view would otherwise vanish (it can't match the
// filter). Seed it with the view's top-level equality constraints so it shows
// up where the user expects — e.g. filter `status == 'reading'` → status:reading.
function seedFromFilter(spec: string): Record<string, string> {
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

/** Dependency-free SVG line/bar chart. Single series; responsive via viewBox. */
function MiniChart({ chart }: { chart: ChartResult }) {
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

function DataTable({ table, spec, source, onChanged }: { table: ViewTable; spec: string; source: string; onChanged: () => void }) {
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
    if (isSelectColumn(c)) {
      const multi = c.schema!.type === "multi_select";
      return (
        <SelectCell
          value={row.cells[c.key]}
          options={c.schema!.options}
          multi={multi}
          editable={c.key !== "$body" && c.key !== "id"}
          onChange={(next) => {
            const value = Array.isArray(next) ? next.join(", ") : next;
            commit(c, row.id, value, multi ? "list" : "text");
          }}
          onOptionsChange={schemaKey ? (opts) => {
            commands.upsertProperty(schemaKey, { name: c.key, type: c.schema!.type, options: opts })
              .then(onChanged).catch((e) => setErr(String(e)));
          } : undefined}
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
            <th className={styles.rowActionCol} />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.id}>
              {table.columns.map((c) => (
                <td key={c.key}>{renderCell(c, row)}</td>
              ))}
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
        <button
          className={styles.newRowBtn}
          onClick={() => {
            commands.addRow(source, newRowId(), { title: "Untitled", created: today(), ...seedFromFilter(spec) })
              .then(onChanged)
              .catch((e) => setErr(String(e)));
          }}
        >
          + New row
        </button>
        <span className={styles.count}>
          {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
          {err && <span className={styles.error}> · {err}</span>}
        </span>
      </div>
    </div>
  );
}

function BoardView({ table, spec, source, onChanged }: {
  table: ViewTable;
  spec: string;
  source: string;
  onChanged: () => void;
}) {
  const groupField = peek(spec, "group");
  if (!groupField) {
    return <div className={styles.error}>Board view needs a <code>group:</code> field in the spec.</div>;
  }

  const groups = new Map<string, ViewTable["rows"]>();
  for (const row of table.rows) {
    const key = toInput(row.cells[groupField]) || "—";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const groupKeys = [...groups.keys()].sort();

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

  const canOpen = source.startsWith("collections/");

  return (
    <div className={styles.board}>
      {groupKeys.map((g) => (
        <div key={g} className={styles.boardCol}>
          <div className={styles.boardColHeader}>
            <span className={styles.boardColTitle}>{g}</span>
            <span className={styles.boardColCount}>{groups.get(g)!.length}</span>
          </div>
          <div className={styles.boardCards}>
            {groups.get(g)!.map((row) => (
              <div key={row.id} className={styles.boardCard}>
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

function CalendarView({ table, spec, source, onChanged }: {
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

function GalleryView({ table, spec, source, onChanged }: {
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

function CortexView({ block, editor }: { block: any; editor: any }) {
  const spec = String(block.props.spec ?? "");
  const lang = String(block.props.lang ?? "cortex-view");
  const declaredType = peek(spec, "type") ?? (lang === "cortex-chart" ? "chart" : "table");
  const source = peek(spec, "source") ?? "—";

  const isChart = declaredType === "chart" || lang === "cortex-chart";
  const isBoard = declaredType === "board";
  const isCalendar = declaredType === "calendar";
  const isGallery = declaredType === "gallery";

  const [table, setTable] = useState<ViewTable | null>(null);
  const [chart, setChart] = useState<ChartResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(spec);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    const p = isChart
      ? commands.runChart(spec).then((c) => { setChart(c); setTable(null); })
      : commands.runView(spec).then((t) => { setTable(t); setChart(null); });
    return p
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [spec, isChart]);

  useEffect(() => { reload(); }, [reload]);

  const saveSpec = () => {
    editor.updateBlock(block, { props: { spec: draft, lang } });
    setEditing(false);
  };

  return (
    <div className={styles.card} contentEditable={false}>
      <div className={styles.header}>
        <span className={styles.badge}>{lang === "cortex-chart" ? "Chart" : "Data view"}</span>
        <span className={styles.meta}>{declaredType} · {source}</span>
        <button
          className={styles.editBtn}
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
            <button className={styles.saveBtn} onClick={saveSpec}>Save</button>
            <button className={styles.cancelBtn} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!editing && !isChart && (
        <ViewToolbar
          spec={spec}
          fields={table?.allColumns ?? []}
          visibleColumns={table?.columns.map((c) => c.key).filter((k) => k !== "$body") ?? []}
          isBoard={isBoard}
          onSpecChange={(next) => editor.updateBlock(block, { props: { spec: next, lang } })}
        />
      )}

      {!editing && (
        <>
          {loading && <div className={styles.stub}>Loading…</div>}
          {error && <div className={styles.error}>{error}</div>}
        </>
      )}

      {!editing && !loading && !error && isChart && chart && (
        chart.points.length === 0
          ? <div className={styles.stub}>No data points for this chart.</div>
          : <MiniChart chart={chart} />
      )}

      {!editing && !loading && !error && !isChart && table && (
        table.rows.length === 0 && !isCalendar
          ? <div className={styles.stub}>No rows match this view.</div>
          : isBoard
            ? <BoardView table={table} spec={spec} source={source} onChanged={reload} />
            : isCalendar
              ? <CalendarView table={table} spec={spec} source={source} onChanged={reload} />
              : isGallery
                ? <GalleryView table={table} spec={spec} source={source} onChanged={reload} />
                : <DataTable table={table} spec={spec} source={source} onChanged={reload} />
      )}
    </div>
  );
}

const cortexViewSpec = createReactBlockSpec(
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
export const cortexSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    cortexView: cortexViewSpec,
    noteEmbed: noteEmbedSpec,
    callout: calloutSpec,
  },
});

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
