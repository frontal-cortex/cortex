// ── Chart settings ───────────────────────────────────────────────────────────
// A chart's ten knobs, behind one chip. A page full of charts should show the
// charts, not the controls that drew them — the controls are one click away,
// the way Filter and Sort are for a table. One panel serves both places a
// chart is configured: a `cortex-view` block in a note (CortexViewBlock) and a
// collection's saved view (DataViews), so they cannot drift apart.
//
// The panel writes engine values, never app state: each row hands its key and
// its new value back, and the caller stores it in the spec or the view. A
// value equal to the engine's own default is handed back as "" so the caller
// can drop the key instead of writing a line that changes nothing.

import { useEffect, useRef, useState } from "react";
import { Dropdown } from "./Dropdown";
import { GearIcon } from "./icons";
import styles from "./ChartSettings.module.css";

export const CHART_AGGS = ["", "sum", "avg", "count", "min", "max"];
export const CHART_BUCKETS = ["", "day", "week", "month", "quarter", "year"];
/** The chart types the engine draws (`cortex_core::data::CHART_TYPES`). */
export const CHART_TYPES = ["line", "bar", "area", "donut", "pie"];
export const CHART_LABELS = ["name", "value", "name_value", "none"];
export const CHART_HEIGHTS = ["small", "medium", "large"];

/** Every chart option, "" for unset. Both callers flatten to this shape. */
export interface ChartOptions {
  x: string;
  y: string;
  agg: string;
  chartType: string;
  bucket: string;
  series: string;
  stack: string;
  labels: string;
  legend: string;
  height: string;
}
export type ChartOptionKey = keyof ChartOptions;

/** A text field that commits when it is left, not per keystroke — every commit
 *  re-runs the query. An outside change (the raw spec editor) still lands. */
function TextRow({ label, value, placeholder, onCommit }: {
  label: string; value: string; placeholder: string; onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <input
        className={styles.rowInput}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim() !== value) onCommit(draft.trim()); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

function SelectRow({ label, value, options, onPick }: {
  label: string; value: string; options: { value: string; label: string }[]; onPick: (v: string) => void;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <Dropdown value={value} options={options} onChange={onPick} className={styles.rowControl} />
    </div>
  );
}

/** The rows themselves, grouped the way a person thinks about a chart: what it
 *  is, what it plots, how it looks. */
export function ChartSettingsPanel({ value, onChange }: {
  value: ChartOptions; onChange: (key: ChartOptionKey, value: string) => void;
}) {
  const ct = value.chartType || "line";
  const round = ct === "donut" || ct === "pie";
  // A chart in the right-hand column of a dashboard has no room to its right:
  // measure once and hang the panel off the chip's other edge when it would
  // run past the window.
  const panelRef = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    setFlip(el.getBoundingClientRect().right > window.innerWidth - 8);
  }, []);
  return (
    <div className={`${styles.panel} ${flip ? styles.panelRight : ""}`} ref={panelRef}>
      <div className={styles.group}>Chart type</div>
      <div className={styles.types}>
        {CHART_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={`${styles.type} ${t === ct ? styles.typeOn : ""}`}
            onClick={() => onChange("chartType", t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className={styles.group}>Data</div>
      <TextRow label={round ? "Slice by" : "X"} value={value.x} placeholder={round ? "field" : "date field"}
        onCommit={(v) => onChange("x", v)} />
      <TextRow label={round ? "Amount" : "Y"} value={value.y} placeholder="number field"
        onCommit={(v) => onChange("y", v)} />
      <SelectRow label="Aggregate" value={value.agg}
        options={CHART_AGGS.map((a) => ({ value: a, label: a || "none" }))}
        onPick={(v) => onChange("agg", v)} />
      <SelectRow label="By" value={value.bucket}
        options={CHART_BUCKETS.map((b) => ({ value: b, label: b || "exact x" }))}
        onPick={(v) => onChange("bucket", v)} />
      <TextRow label="Series" value={value.series} placeholder="field (one line each)"
        onCommit={(v) => onChange("series", v)} />

      <div className={styles.group}>Style</div>
      {(ct === "bar" || ct === "area") && (
        <SelectRow label="Stack" value={value.stack === "true" ? "true" : ""}
          options={[{ value: "", label: "no" }, { value: "true", label: "yes" }]}
          onPick={(v) => onChange("stack", v)} />
      )}
      {round && (
        <SelectRow label="Labels" value={value.labels || "name"}
          options={CHART_LABELS.map((l) => ({ value: l, label: l.replace("_", " + ") }))}
          onPick={(v) => onChange("labels", v === "name" ? "" : v)} />
      )}
      <SelectRow label="Legend" value={value.legend === "false" ? "false" : ""}
        options={[{ value: "", label: "shown" }, { value: "false", label: "hidden" }]}
        onPick={(v) => onChange("legend", v)} />
      <SelectRow label="Height" value={value.height || "medium"}
        options={CHART_HEIGHTS.map((h) => ({ value: h, label: h }))}
        onPick={(v) => onChange("height", v === "medium" ? "" : v)} />
    </div>
  );
}

/** The chip and its panel — what a chart shows above itself. A chart that
 *  cannot be drawn yet opens the panel itself, so the fields are in front of
 *  whoever just added it. */
export function ChartSettings({ value, onChange }: {
  value: ChartOptions; onChange: (key: ChartOptionKey, value: string) => void;
}) {
  const [open, setOpen] = useState(!value.x || !value.y);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className={styles.bar}>
      <div className={styles.control} ref={ref}>
        <button
          className={`${styles.chip} ${open ? styles.chipOn : ""}`}
          onClick={() => setOpen((o) => !o)}
          title="Chart settings"
        >
          <GearIcon size={12} /> Settings
        </button>
        {open && <ChartSettingsPanel value={value} onChange={onChange} />}
      </div>
    </div>
  );
}
