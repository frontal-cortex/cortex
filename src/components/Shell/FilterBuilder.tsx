// The filter clauses of a view, a stats tile or a rollup, as rows of pickers:
// property, condition, value. The value is what the property holds — a date
// offers "This month" and a calendar, a select its options, a checkbox yes or
// no — so nobody types `date >= @month`. One component for every place a
// filter is set (ViewToolbar, StatsEditor, a rollup's `where`), so they read
// the same and cannot drift apart.

import { useEffect, useRef, useState } from "react";
import { commands, FilterClause, PropertyDef } from "../../lib/commands";
import { DATE_PRESETS, filterOf } from "../../lib/visualSpec";
import { Dropdown } from "./Dropdown";
import { CloseIcon } from "./icons";
import { isDateProp, useRowTitles } from "./useSourceFields";
import styles from "./ViewToolbar.module.css";

const OPS: { value: string; label: string }[] = [
  { value: "==", label: "is" },
  { value: "!=", label: "is not" },
  { value: ">", label: ">" },
  { value: ">=", label: "≥" },
  { value: "<", label: "<" },
  { value: "<=", label: "≤" },
  { value: "contains", label: "contains" },
  { value: "does_not_contain", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
  { value: "in", label: "is any of" },
  { value: "within", label: "within" },
];

/** The same conditions, worded for a date. */
const DATE_OPS: { value: string; label: string }[] = [
  { value: "==", label: "is" },
  { value: "!=", label: "is not" },
  { value: ">=", label: "is on or after" },
  { value: ">", label: "is after" },
  { value: "<=", label: "is on or before" },
  { value: "<", label: "is before" },
  { value: "within", label: "is within" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const WITHIN: { value: string; label: string }[] = [
  { value: "-7d", label: "the past week" },
  { value: "-30d", label: "the past 30 days" },
  { value: "-1y", label: "the past year" },
  { value: "7d", label: "the next week" },
  { value: "30d", label: "the next 30 days" },
];

export const NO_VALUE_OPS = new Set(["is_empty", "is_not_empty"]);
const VALUE_HINT: Record<string, string> = { in: "a, b, c", within: "7d, -7d, 2w, 1m" };

export function newClause(field: string, d?: PropertyDef): FilterClause {
  if (isDateProp(field, d)) return { field, op: ">=", value: "@month" };
  // A relation or multi-select holds a list: "contains" is what "links to" means.
  if (d?.type === "relation" || d?.type === "multi_select") return { field, op: "contains", value: "" };
  return { field, op: "==", value: "" };
}

/** The value box of one clause, shaped by the property's type. */
function ValueInput({ clause, prop, onChange }: { clause: FilterClause; prop?: PropertyDef; onChange: (v: string) => void }) {
  const { field, op, value } = clause;
  const [custom, setCustom] = useState(false);
  const related = prop?.type === "relation" && !prop.from && (op === "contains" || op === "does_not_contain" || op === "==" || op === "!=");
  const titles = useRowTitles(related ? prop?.collection : undefined);
  if (isDateProp(field, prop) && op !== "in") {
    if (op === "within") {
      const known = WITHIN.some((w) => w.value === value);
      return known || !value
        ? <Dropdown value={value} placeholder="Pick a span" options={[...WITHIN, { value: "__custom", label: "Other…", separator: true }]}
            onChange={(v) => (v === "__custom" ? onChange("14d") : onChange(v))} />
        : <input className={styles.valueInput} value={value} placeholder={VALUE_HINT.within} spellCheck={false} onChange={(e) => onChange(e.target.value)} />;
    }
    const preset = DATE_PRESETS.some((p) => p.value === value);
    const isDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (custom || isDay || (value && !preset)) {
      return (
        <span className={styles.dateValue}>
          <input type="date" className={styles.valueInput} value={isDay ? value : ""} onChange={(e) => onChange(e.target.value)} />
          <button className={styles.rowDel} title="Use a relative date" onClick={() => { setCustom(false); onChange("@today"); }}>↺</button>
        </span>
      );
    }
    return (
      <Dropdown value={value} placeholder="Pick a date"
        options={[...DATE_PRESETS, { value: "__date", label: "A specific date…", separator: true }]}
        onChange={(v) => { if (v === "__date") { setCustom(true); onChange(""); } else onChange(v); }} />
    );
  }
  const t = prop?.type;
  const options = prop?.options ?? [];
  if (options.length && (t === "select" || t === "status" || t === "multi_select") && op !== "in") {
    return <Dropdown value={value} placeholder="Pick an option" options={options.map((o) => ({ value: o.name, label: o.name }))} onChange={onChange} />;
  }
  if (related && titles.length) {
    return <Dropdown value={value} placeholder={`Pick from ${prop?.collection}`} options={[...(value && !titles.includes(value) ? [value] : []), ...titles].map((x) => ({ value: x, label: x }))} onChange={onChange} />;
  }
  if (t === "checkbox") {
    return <Dropdown value={value} placeholder="Pick" options={[{ value: "true", label: "Checked" }, { value: "false", label: "Unchecked" }]} onChange={onChange} />;
  }
  return (
    <input className={styles.valueInput} value={value} placeholder={VALUE_HINT[op] ?? "value"} spellCheck={false}
      inputMode={t === "number" || t === "rollup" ? "decimal" : undefined}
      onChange={(e) => onChange(e.target.value)} />
  );
}

export function FilterBuilder({ filters, join, fields, props = {}, onChange }: {
  filters: FilterClause[];
  join: string;
  fields: string[];
  props?: Record<string, PropertyDef>;
  onChange: (filters: FilterClause[], join: string) => void;
}) {
  const firstField = fields[0] ?? "title";
  const commit = (f: FilterClause[], j = join) => onChange(f, j);

  // A path is [i] for a top-level clause, [i, k] for the k-th clause of the group at i.
  const updateAt = (path: number[], f: (c: FilterClause) => FilterClause | null): FilterClause[] => {
    const [i, k] = path;
    return filters.flatMap((c, j) => {
      if (j !== i) return [c];
      if (k === undefined) { const n = f(c); return n ? [n] : []; }
      const inner = (c.clauses ?? []).flatMap((g, m) => { if (m !== k) return [g]; const n = f(g); return n ? [n] : []; });
      return inner.length ? [{ ...c, clauses: inner }] : [];
    });
  };
  const setField = (path: number[], field: string) =>
    // A new property gets the condition that suits it (a date: on or after this month).
    commit(updateAt(path, (c) => (c.field === field ? c : newClause(field, props[field]))));
  const setClause = (path: number[], patch: Partial<FilterClause>) =>
    commit(updateAt(path, (c) => ({ ...c, ...patch, ...(patch.op && NO_VALUE_OPS.has(patch.op) ? { value: "" } : {}) })));
  const remove = (path: number[]) => commit(updateAt(path, () => null));
  const add = () => commit([...filters, newClause(firstField, props[firstField])]);
  const addGroup = () =>
    commit([...filters, { field: "", op: "", value: "", join: join === "or" ? "and" : "or", clauses: [newClause(firstField, props[firstField])] }]);
  const addToGroup = (i: number) =>
    commit(filters.map((c, j) => (j === i ? { ...c, clauses: [...(c.clauses ?? []), newClause(firstField, props[firstField])] } : c)));
  const toggleJoin = () => commit(filters, join === "or" ? "and" : "or");
  const toggleGroupJoin = (i: number) =>
    commit(filters.map((c, j) => (j === i ? { ...c, join: c.join === "or" ? "and" : "or" } : c)));

  const referenced = [...new Set([...fields, ...filters.flatMap((f) => (f.clauses?.length ? f.clauses.map((c) => c.field) : [f.field]))])].filter(Boolean);

  const row = (f: FilterClause, path: number[], lead: React.ReactNode) => {
    const date = isDateProp(f.field, props[f.field]);
    return (
      <div key={path.join(".")} className={styles.clauseRow}>
        {lead}
        <Dropdown value={f.field} options={referenced.map((fl) => ({ value: fl, label: fl }))} onChange={(v) => setField(path, v)} />
        <Dropdown value={f.op} options={date ? DATE_OPS : OPS} onChange={(v) => setClause(path, { op: v })} />
        {!NO_VALUE_OPS.has(f.op) && <ValueInput clause={f} prop={props[f.field]} onChange={(v) => setClause(path, { value: v })} />}
        <button className={styles.rowDel} onClick={() => remove(path)} title="Remove">
          <CloseIcon size={12} />
        </button>
      </div>
    );
  };

  return (
    <>
      {filters.length === 0 && <div className={styles.empty}>No filters yet.</div>}
      {filters.map((f, i) => {
        const lead = i > 0
          ? <button className={styles.joinToggle} onClick={toggleJoin}>{join}</button>
          : <span className={styles.joinWhere}>Where</span>;
        if (!f.clauses?.length) return row(f, [i], lead);
        const gj = f.join || "and";
        return (
          <div key={i} className={styles.clauseRow}>
            {lead}
            <div className={styles.group}>
              {f.clauses.map((g, k) => row(g, [i, k], k > 0
                ? <button className={styles.joinToggle} onClick={() => toggleGroupJoin(i)}>{gj}</button>
                : <span className={styles.joinWhere}>(</span>))}
              <button className={styles.addBtn} onClick={() => addToGroup(i)}>+ Add to group</button>
            </div>
          </div>
        );
      })}
      <div className={styles.clauseRow}>
        <button className={styles.addBtn} onClick={add}>+ Add filter</button>
        <button className={styles.addBtn} onClick={addGroup}>+ Add group</button>
      </div>
    </>
  );
}

/** A filter kept as text (a stats tile's `filter:`, a rollup's `where:`),
 *  edited as clauses. The text is parsed and written by the engine's own
 *  filter parser, through a one-line spec, so what is saved is exactly what a
 *  hand-written filter would be. A filter too tangled for rows stays text. */
export function FilterText({ value, fields, props, onChange }: {
  value: string;
  fields: string[];
  props?: Record<string, PropertyDef>;
  onChange: (filter: string) => void;
}) {
  const [parsed, setParsed] = useState<{ filters: FilterClause[]; join: string; complex: boolean } | null>(null);
  // The text this editor last wrote. When it comes back as `value`, the rows
  // already show it: parsing it again could land after a newer keystroke.
  const emitted = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    const text = value.trim();
    if (parsed && emitted.current === text) return;
    if (!text) { setParsed({ filters: [], join: "and", complex: false }); return; }
    commands.parseViewSpec(`source: x\nfilter: ${JSON.stringify(text)}\n`)
      .then((s) => { if (live) setParsed({ filters: s.filters, join: s.filterJoin || "and", complex: s.filterComplex }); })
      .catch(() => { if (live) setParsed({ filters: [], join: "and", complex: true }); });
    return () => { live = false; };
  }, [value]);
  if (!parsed) return null;
  if (parsed.complex) {
    return (
      <input className={styles.valueInput} value={value} spellCheck={false} title="This filter is too involved for rows; edit it as text"
        onChange={(e) => onChange(e.target.value)} />
    );
  }
  return (
    <FilterBuilder
      filters={parsed.filters}
      join={parsed.join}
      fields={fields}
      props={props}
      onChange={(filters, join) => {
        setParsed({ filters, join, complex: false });
        commands.serializeViewSpec({ source: "x", filters, filterJoin: join, filterComplex: false, sort: [] })
          .then((spec) => { const f = filterOf(spec); emitted.current = f; onChange(f); })
          .catch(() => {});
      }}
    />
  );
}
