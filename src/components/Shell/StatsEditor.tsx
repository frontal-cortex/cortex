// A stats view's tiles, edited as tiles: each one a name, then either a
// number worked out from rows (Sum of amount in Expenses, only rows dated this
// month, shown as currency) or a formula over the tiles before it (Earned −
// Spent), picked from lists. The spec's `stats:` list is what gets written —
// the same YAML a person would type — so the raw editor and a pack's README
// still describe exactly what this made.

import { useEffect, useState } from "react";
import { PropertyDef } from "../../lib/commands";
import { AGGREGATES, NUMBER_FORMATS, StatEntry, renameInFormula, statIdent } from "../../lib/visualSpec";
import { Dropdown } from "./Dropdown";
import { FilterText } from "./FilterBuilder";
import { CloseIcon, PlusIcon } from "./icons";
import { useCollections, useSourceFields } from "./useSourceFields";
import styles from "./StatsEditor.module.css";

/** A text box that writes when it is left or Enter is pressed — every write
 *  re-runs the tiles, so not per keystroke. */
function Field({ value, placeholder, onCommit, className, mono }: {
  value: string; placeholder: string; onCommit: (v: string) => void; className?: string; mono?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <input
      className={`${styles.input} ${mono ? styles.mono : ""} ${className ?? ""}`}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

const sourceOf = (e: StatEntry, fallback: string) => {
  const s = (e.source ?? "").trim();
  return s ? (s.includes("/") ? s : `collections/${s}`) : fallback;
};

/** Which fields a function can use: counting needs none, sums need numbers. */
function fieldChoices(names: string[], props: Record<string, PropertyDef>, agg: string): string[] {
  if (agg === "count") return [];
  const numeric = (n: string) => {
    const d = props[n];
    return !d || d.type === "number" || d.type === "rollup" || d.type === "formula";
  };
  if (agg === "sum" || agg === "avg") return names.filter((n) => n !== "title" && numeric(n));
  if (agg === "percent_checked") return names.filter((n) => props[n]?.type === "checkbox");
  return names;
}

function Tile({ entry, index, count, earlier, defaultSource, onChange, onMove, onRemove }: {
  entry: StatEntry;
  index: number;
  count: number;
  /** Labels of the tiles before this one — what a formula may use. */
  earlier: string[];
  defaultSource: string;
  onChange: (e: StatEntry) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const isFormula = entry.expr !== undefined;
  const source = sourceOf(entry, defaultSource);
  const { names, props } = useSourceFields(isFormula ? undefined : source);
  const collections = useCollections();
  const agg = entry.agg || "count";
  const fields = fieldChoices(names, props, agg);
  const [showFilter, setShowFilter] = useState(!!entry.filter);
  const set = (patch: Record<string, string | undefined>) => {
    const next: StatEntry = { ...entry };
    // An emptied formula stays a formula (`expr: ""`); any other emptied value goes.
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || (v === "" && k !== "expr")) delete next[k]; else next[k] = v; }
    onChange(next);
  };

  const sourceOptions = [
    ...collections.map((c) => ({ value: `collections/${c}`, label: c })),
    ...(!source.startsWith("collections/") ? [{ value: source, label: source }] : []),
  ];

  return (
    <div className={styles.tile}>
      <div className={styles.tileHead}>
        <Field className={styles.label} value={entry.label ?? ""} placeholder="Name" onCommit={(v) => set({ label: v })} />
        <div className={styles.mode} role="radiogroup" aria-label="What the tile shows">
          <button type="button" role="radio" aria-checked={!isFormula} className={`${styles.modeBtn} ${!isFormula ? styles.modeOn : ""}`}
            onClick={() => { if (isFormula) onChange({ label: entry.label ?? "", agg: "count", ...(entry.format ? { format: entry.format } : {}) }); }}>
            From rows
          </button>
          <button type="button" role="radio" aria-checked={isFormula} className={`${styles.modeBtn} ${isFormula ? styles.modeOn : ""}`}
            onClick={() => { if (!isFormula) onChange({ label: entry.label ?? "", expr: "", ...(entry.format ? { format: entry.format } : {}) }); }}>
            Formula
          </button>
        </div>
        <span className={styles.spacer} />
        <button type="button" className={styles.iconBtn} disabled={index === 0} title="Move earlier" onClick={() => onMove(-1)}>↑</button>
        <button type="button" className={styles.iconBtn} disabled={index === count - 1} title="Move later" onClick={() => onMove(1)}>↓</button>
        <button type="button" className={styles.iconBtn} title="Remove this tile" onClick={onRemove}><CloseIcon size={12} /></button>
      </div>

      {isFormula ? (
        <div className={styles.line}>
          <span className={styles.word}>=</span>
          <Field mono className={styles.grow} value={entry.expr ?? ""} placeholder={earlier.length >= 2 ? `${statIdent(earlier[1])} - ${statIdent(earlier[0])}` : "a formula over the tiles before this one"}
            onCommit={(v) => set({ expr: v })} />
          {earlier.length > 0 && (
            <span className={styles.chips}>
              {earlier.map((l) => (
                <button key={l} type="button" className={styles.chip} title={`Use ${l}`}
                  onClick={() => set({ expr: `${(entry.expr ?? "").trimEnd()}${entry.expr?.trim() ? " " : ""}${statIdent(l)}` })}>
                  {l}
                </button>
              ))}
            </span>
          )}
        </div>
      ) : (
        <>
          <div className={styles.line}>
            <Dropdown value={agg} options={AGGREGATES} onChange={(v) => {
              const keep = fieldChoices(names, props, v).includes(entry.field ?? "");
              set({ agg: v, field: v === "count" ? undefined : keep ? entry.field : fieldChoices(names, props, v)[0] });
            }} />
            {agg !== "count" && (
              <>
                <span className={styles.word}>of</span>
                <Dropdown value={entry.field ?? ""} placeholder="a property" options={fields.map((f) => ({ value: f, label: f }))} onChange={(v) => set({ field: v })} />
              </>
            )}
            <span className={styles.word}>in</span>
            <Dropdown value={source} options={sourceOptions} onChange={(v) => set({ source: v === defaultSource ? undefined : v, field: undefined, filter: undefined })} />
          </div>
          {showFilter || entry.filter ? (
            <div className={styles.filter}>
              <span className={styles.filterTitle}>Only rows where</span>
              <FilterText value={entry.filter ?? ""} fields={names} props={props}
                onChange={(f) => { set({ filter: f }); if (!f) setShowFilter(false); }} />
            </div>
          ) : (
            <button type="button" className={styles.add} onClick={() => setShowFilter(true)}>+ Only count some rows</button>
          )}
        </>
      )}

      <div className={styles.line}>
        <span className={styles.word}>Show as</span>
        <Dropdown value={entry.format ?? ""} options={NUMBER_FORMATS} onChange={(v) => set({ format: v })} />
      </div>
    </div>
  );
}

export function StatsEditor({ entries, defaultSource, onChange }: {
  entries: StatEntry[];
  /** The view's own source — a tile with no `source:` counts its rows. */
  defaultSource: string;
  onChange: (entries: StatEntry[]) => void;
}) {
  const update = (i: number, e: StatEntry) => {
    const before = entries[i]?.label ?? "";
    const after = e.label ?? "";
    onChange(entries.map((x, j) => {
      if (j === i) return e;
      // A renamed tile keeps the formulas after it that use it working.
      if (j > i && x.expr && before && after && before !== after) return { ...x, expr: renameInFormula(x.expr, before, after) };
      return x;
    }));
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...entries];
    const [e] = next.splice(i, 1);
    next.splice(i + by, 0, e);
    onChange(next);
  };
  const name = (base: string) => {
    const taken = new Set(entries.map((e) => e.label));
    let n = base, k = 2;
    while (taken.has(n)) n = `${base} ${k++}`;
    return n;
  };
  return (
    <div className={styles.editor} role="group" aria-label="Stats tiles">
      {entries.length === 0 && <div className={styles.empty}>No tiles yet.</div>}
      {entries.map((e, i) => (
        <Tile
          // Position, not label: renaming a tile must not remount it mid-edit.
          key={i}
          entry={e}
          index={i}
          count={entries.length}
          earlier={entries.slice(0, i).map((x) => x.label).filter(Boolean)}
          defaultSource={defaultSource}
          onChange={(x) => update(i, x)}
          onMove={(by) => move(i, by)}
          onRemove={() => onChange(entries.filter((_, j) => j !== i))}
        />
      ))}
      <div className={styles.adds}>
        <button type="button" className={styles.add} onClick={() => onChange([...entries, { label: name("Total"), agg: "count" }])}>
          <PlusIcon size={12} /> Number from rows
        </button>
        <button type="button" className={styles.add} onClick={() => onChange([...entries, { label: name("Result"), expr: "" }])}>
          <PlusIcon size={12} /> Formula
        </button>
      </div>
    </div>
  );
}
