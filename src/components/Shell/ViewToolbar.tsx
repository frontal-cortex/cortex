// GUI filter / sort / group / columns builder for a data view. Edits the
// STRUCTURED form of the spec (parsed by Rust) and serializes straight back to
// YAML — the on-disk spec stays the source of truth, so a view built here is
// identical to a hand-written one. A filter too complex to flatten (mixed
// and/or) is surfaced as a notice that defers to the raw "Edit" escape hatch.

import { useEffect, useRef, useState } from "react";
import { commands, StructuredSpec, FilterClause } from "../../lib/commands";
import { Dropdown } from "./Dropdown";
import { CloseIcon } from "./icons";
import styles from "./ViewToolbar.module.css";

const OPS: { value: string; label: string }[] = [
  { value: "==", label: "is" },
  { value: "!=", label: "is not" },
  { value: ">", label: ">" },
  { value: ">=", label: "≥" },
  { value: "<", label: "<" },
  { value: "<=", label: "≤" },
  { value: "contains", label: "contains" },
];

function usePopover() {
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
  return { open, setOpen, ref };
}

interface Props {
  spec: string;
  /** All source fields (the universe) — for the dropdowns and the column list. */
  fields: string[];
  /** Fields currently shown (the projected columns) — for checkbox state. */
  visibleColumns: string[];
  /** Whether this view is a board (enables the Group control). */
  isBoard: boolean;
  onSpecChange: (nextSpec: string) => void;
}

export function ViewToolbar({ spec, fields, visibleColumns, isBoard, onSpecChange }: Props) {
  const [s, setS] = useState<StructuredSpec | null>(null);

  useEffect(() => {
    let alive = true;
    commands.parseViewSpec(spec)
      .then((parsed) => { if (alive) setS(parsed); })
      .catch(() => { if (alive) setS(null); });
  }, [spec]);

  const filterPop = usePopover();
  const sortPop = usePopover();
  const colsPop = usePopover();
  const groupPop = usePopover();

  if (!s) return null;

  // All selectable fields: the table's columns plus any field already named in
  // the spec (so hidden-but-referenced fields stay editable).
  const referenced = new Set<string>([
    ...fields,
    ...s.filters.map((f) => f.field),
    ...s.sort.map((so) => so.field),
    ...(s.group ? [s.group] : []),
  ]);
  const allFields = [...referenced].filter((f) => f && f !== "$body");
  const firstField = allFields[0] ?? "title";

  const commit = (next: StructuredSpec) => {
    setS(next);
    commands.serializeViewSpec(next).then(onSpecChange).catch(() => {});
  };

  // ── Filters ──
  const setFilter = (i: number, patch: Partial<FilterClause>) =>
    commit({ ...s, filters: s.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const addFilter = () =>
    commit({ ...s, filters: [...s.filters, { field: firstField, op: "==", value: "" }] });
  const removeFilter = (i: number) =>
    commit({ ...s, filters: s.filters.filter((_, j) => j !== i) });
  const toggleJoin = () =>
    commit({ ...s, filterJoin: s.filterJoin === "or" ? "and" : "or" });

  // ── Sort ──
  const addSort = () =>
    commit({ ...s, sort: [...s.sort, { field: firstField, desc: false }] });
  const setSort = (i: number, patch: Partial<{ field: string; desc: boolean }>) =>
    commit({ ...s, sort: s.sort.map((so, j) => (j === i ? { ...so, ...patch } : so)) });
  const removeSort = (i: number) =>
    commit({ ...s, sort: s.sort.filter((_, j) => j !== i) });

  // ── Columns (visibility). `columns: null` means "all" — toggling materializes
  // an explicit ordered list. ──
  const visible = s.columns ?? visibleColumns;
  const toggleColumn = (key: string) => {
    const base = s.columns ?? visibleColumns;
    const next = base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
    commit({ ...s, columns: next });
  };

  // ── Group (board only) ──
  const setGroup = (field: string) => { commit({ ...s, group: field }); groupPop.setOpen(false); };

  const filterCount = s.filterComplex ? 1 : s.filters.length;

  return (
    <div className={styles.bar}>
      {/* Filter */}
      <div className={styles.control} ref={filterPop.ref}>
        <button
          className={`${styles.chip} ${filterCount ? styles.chipActive : ""}`}
          onClick={() => filterPop.setOpen((o) => !o)}
        >
          Filter{filterCount ? ` · ${filterCount}` : ""}
        </button>
        {filterPop.open && (
          <div className={styles.popover}>
            {s.filterComplex ? (
              <div className={styles.notice}>
                This filter mixes <code>and</code>/<code>or</code>. Use the raw
                <strong> Edit </strong> view to change it.
              </div>
            ) : (
              <>
                {s.filters.length === 0 && <div className={styles.empty}>No filters yet.</div>}
                {s.filters.map((f, i) => (
                  <div key={i} className={styles.clauseRow}>
                    {i > 0 ? (
                      <button className={styles.joinToggle} onClick={toggleJoin}>{s.filterJoin}</button>
                    ) : (
                      <span className={styles.joinWhere}>Where</span>
                    )}
                    <Dropdown
                      value={f.field}
                      options={allFields.map((fl) => ({ value: fl, label: fl }))}
                      onChange={(v) => setFilter(i, { field: v })}
                    />
                    <Dropdown
                      value={f.op}
                      options={OPS}
                      onChange={(v) => setFilter(i, { op: v })}
                    />
                    <input className={styles.valueInput} value={f.value} placeholder="value"
                      spellCheck={false}
                      onChange={(e) => setFilter(i, { value: e.target.value })} />
                    <button className={styles.rowDel} onClick={() => removeFilter(i)} title="Remove">
                      <CloseIcon size={12} />
                    </button>
                  </div>
                ))}
                <button className={styles.addBtn} onClick={addFilter}>+ Add filter</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Sort */}
      <div className={styles.control} ref={sortPop.ref}>
        <button
          className={`${styles.chip} ${s.sort.length ? styles.chipActive : ""}`}
          onClick={() => sortPop.setOpen((o) => !o)}
        >
          Sort{s.sort.length ? ` · ${s.sort.length}` : ""}
        </button>
        {sortPop.open && (
          <div className={styles.popover}>
            {s.sort.length === 0 && <div className={styles.empty}>No sorts yet.</div>}
            {s.sort.map((so, i) => (
              <div key={i} className={styles.clauseRow}>
                <Dropdown
                  value={so.field}
                  options={allFields.map((fl) => ({ value: fl, label: fl }))}
                  onChange={(v) => setSort(i, { field: v })}
                />
                <button className={styles.dirToggle}
                  onClick={() => setSort(i, { desc: !so.desc })}
                  title={so.desc ? "Descending" : "Ascending"}>
                  {so.desc ? "↓ Desc" : "↑ Asc"}
                </button>
                <button className={styles.rowDel} onClick={() => removeSort(i)} title="Remove">
                  <CloseIcon size={12} />
                </button>
              </div>
            ))}
            <button className={styles.addBtn} onClick={addSort}>+ Add sort</button>
          </div>
        )}
      </div>

      {/* Columns */}
      {fields.length > 0 && (
        <div className={styles.control} ref={colsPop.ref}>
          <button className={styles.chip} onClick={() => colsPop.setOpen((o) => !o)}>
            Properties
          </button>
          {colsPop.open && (
            <div className={styles.popover}>
              {fields.filter((f) => f !== "$body").map((f) => (
                <label key={f} className={styles.checkRow}>
                  <input type="checkbox" checked={visible.includes(f)}
                    onChange={() => toggleColumn(f)} />
                  {f}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Group (board) */}
      {isBoard && (
        <div className={styles.control} ref={groupPop.ref}>
          <button className={`${styles.chip} ${s.group ? styles.chipActive : ""}`}
            onClick={() => groupPop.setOpen((o) => !o)}>
            Group{s.group ? ` · ${s.group}` : ""}
          </button>
          {groupPop.open && (
            <div className={styles.popover}>
              {allFields.map((f) => (
                <button key={f}
                  className={`${styles.optionBtn} ${s.group === f ? styles.optionOn : ""}`}
                  onClick={() => setGroup(f)}>
                  {f}{s.group === f ? " ✓" : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
