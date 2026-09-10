// GUI filter / sort / group / columns builder for a data view. Edits the
// STRUCTURED form of the spec (parsed by Rust) and serializes straight back to
// YAML — the on-disk spec stays the source of truth, so a view built here is
// identical to a hand-written one. Clauses join under one connector, and a
// clause may be one parenthesised group with its own — `a and (b or c)`. A
// filter too complex to flatten (mixed and/or without parentheses, nested
// groups, `not`) is surfaced as a notice that defers to the raw "Edit" escape
// hatch.

import { useEffect, useRef, useState, type RefObject } from "react";
import { commands, StructuredSpec, FilterClause } from "../../lib/commands";
import { isMac } from "../../lib/keymap";
import { Dropdown } from "./Dropdown";
import { CloseIcon, GearIcon, SearchIcon } from "./icons";
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

const NO_VALUE_OPS = new Set(["is_empty", "is_not_empty"]);
const VALUE_HINT: Record<string, string> = { in: "a, b, c", within: "7d, -7d, 2w, 1m" };

function newClause(field: string): FilterClause {
  return { field, op: "==", value: "" };
}

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
  /** Whether this view is a board (a group is required). */
  isBoard: boolean;
  /** Whether this view is a table (a group is optional — sections, or none). */
  isTable?: boolean;
  onSpecChange: (nextSpec: string) => void;
  /** The search box: a client-side narrowing of the rows shown, never part of
   *  the spec. Absent = no box. */
  search?: string;
  onSearchChange?: (query: string) => void;
  /** So a data view can hand focus here on mod+f. */
  searchRef?: RefObject<HTMLInputElement | null>;
  /** Keep the controls behind a Settings chip until they are asked for. A view
   *  block on a page is there to show its rows, not the knobs that shaped
   *  them; a collection's own page leaves this off, since working the database
   *  is what that page is for. */
  collapsible?: boolean;
  /** The chip's state, held by the parent so mod+f can open the bar to reach
   *  the search box. Only read when `collapsible`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ViewToolbar({ spec, fields, visibleColumns, isBoard, isTable, onSpecChange, search, onSearchChange, searchRef, collapsible, open, onOpenChange }: Props) {
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
  const bucketPop = usePopover();

  // The search box: typed text is debounced into the parent's query; clearing
  // is immediate. The parent may reset it (a view switch) — follow that.
  const [query, setQuery] = useState(search ?? "");
  useEffect(() => { setQuery(search ?? ""); }, [search]);
  useEffect(() => {
    if (!onSearchChange || query === (search ?? "")) return;
    const t = setTimeout(() => onSearchChange(query), 150);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearSearch = () => { setQuery(""); onSearchChange?.(""); };

  if (!s) return null;

  // All selectable fields: the table's columns plus any field already named in
  // the spec (so hidden-but-referenced fields stay editable).
  const referenced = new Set<string>([
    ...fields,
    ...s.filters.flatMap((f) => (f.clauses?.length ? f.clauses.map((c) => c.field) : [f.field])),
    ...s.sort.map((so) => so.field),
    ...(s.group ? [s.group] : []),
  ]);
  const allFields = [...referenced].filter((f) => f && f !== "$body");
  const firstField = allFields[0] ?? "title";

  const commit = (next: StructuredSpec) => {
    setS(next);
    commands.serializeViewSpec(next).then(onSpecChange).catch(() => {});
  };

  // ── Filters. A path is [i] for a top-level clause, [i, k] for the k-th
  // clause of the group at i. ──
  const updateAt = (path: number[], f: (c: FilterClause) => FilterClause | null): FilterClause[] => {
    const [i, k] = path;
    return s.filters.flatMap((c, j) => {
      if (j !== i) return [c];
      if (k === undefined) { const n = f(c); return n ? [n] : []; }
      const inner = (c.clauses ?? []).flatMap((g, m) => { if (m !== k) return [g]; const n = f(g); return n ? [n] : []; });
      return inner.length ? [{ ...c, clauses: inner }] : [];
    });
  };
  const setFilter = (path: number[], patch: Partial<FilterClause>) =>
    commit({ ...s, filters: updateAt(path, (c) => ({ ...c, ...patch, ...(patch.op && NO_VALUE_OPS.has(patch.op) ? { value: "" } : {}) })) });
  const removeFilter = (path: number[]) => commit({ ...s, filters: updateAt(path, () => null) });
  const addFilter = () => commit({ ...s, filters: [...s.filters, newClause(firstField)] });
  const addGroup = () =>
    commit({ ...s, filters: [...s.filters, { field: "", op: "", value: "", join: s.filterJoin === "or" ? "and" : "or", clauses: [newClause(firstField)] }] });
  const addToGroup = (i: number) =>
    commit({ ...s, filters: s.filters.map((c, j) => (j === i ? { ...c, clauses: [...(c.clauses ?? []), newClause(firstField)] } : c)) });
  const toggleJoin = () =>
    commit({ ...s, filterJoin: s.filterJoin === "or" ? "and" : "or" });
  const toggleGroupJoin = (i: number) =>
    commit({ ...s, filters: s.filters.map((c, j) => (j === i ? { ...c, join: c.join === "or" ? "and" : "or" } : c)) });

  const clauseRow = (f: FilterClause, path: number[], lead: React.ReactNode) => (
    <div key={path.join(".")} className={styles.clauseRow}>
      {lead}
      <Dropdown
        value={f.field}
        options={allFields.map((fl) => ({ value: fl, label: fl }))}
        onChange={(v) => setFilter(path, { field: v })}
      />
      <Dropdown
        value={f.op}
        options={OPS}
        onChange={(v) => setFilter(path, { op: v })}
      />
      {!NO_VALUE_OPS.has(f.op) && (
        <input className={styles.valueInput} value={f.value} placeholder={VALUE_HINT[f.op] ?? "value"}
          spellCheck={false}
          onChange={(e) => setFilter(path, { value: e.target.value })} />
      )}
      <button className={styles.rowDel} onClick={() => removeFilter(path)} title="Remove">
        <CloseIcon size={12} />
      </button>
    </div>
  );

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

  // ── Group (board: required; table: optional sections) ──
  const setGroup = (field: string | null) => { commit({ ...s, group: field }); groupPop.setOpen(false); };
  // How a date group folds: day | week | month | quarter | year (the engine ignores it for non-dates).
  const bucket = typeof s.bucket === "string" ? s.bucket : "";
  const setBucket = (b: string) => { commit({ ...s, bucket: b || undefined }); bucketPop.setOpen(false); };

  const filterCount = s.filterComplex ? 1 : s.filters.length;
  // Tinted while something is narrowing the rows, so a filtered view never
  // looks like a short one.
  const shaping = filterCount > 0 || s.sort.length > 0 || !!s.group || !!(search ?? "").trim();

  if (collapsible && !open) {
    return (
      <div className={styles.bar}>
        <button
          className={`${styles.chip} ${styles.settingsChip} ${shaping ? styles.chipActive : ""}`}
          onClick={() => onOpenChange?.(true)}
          title="Filter, sort, properties and search"
        >
          <GearIcon size={12} /> Settings
        </button>
      </div>
    );
  }

  return (
    <div className={styles.bar}>
      {collapsible && (
        <button
          className={`${styles.chip} ${styles.settingsChip} ${styles.chipActive}`}
          onClick={() => onOpenChange?.(false)}
          title="Hide these controls"
        >
          <GearIcon size={12} /> Settings
        </button>
      )}

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
                This filter nests groups, uses <code>not</code>, or mixes
                <code> and</code>/<code>or</code> without parentheses. Use the raw
                <strong> Edit </strong> view to change it.
              </div>
            ) : (
              <>
                {s.filters.length === 0 && <div className={styles.empty}>No filters yet.</div>}
                {s.filters.map((f, i) => {
                  const lead = i > 0 ? (
                    <button className={styles.joinToggle} onClick={toggleJoin}>{s.filterJoin}</button>
                  ) : (
                    <span className={styles.joinWhere}>Where</span>
                  );
                  if (!f.clauses?.length) return clauseRow(f, [i], lead);
                  const join = f.join || "and";
                  return (
                    <div key={i} className={styles.clauseRow}>
                      {lead}
                      <div className={styles.group}>
                        {f.clauses.map((g, k) => clauseRow(g, [i, k], k > 0 ? (
                          <button className={styles.joinToggle} onClick={() => toggleGroupJoin(i)}>{join}</button>
                        ) : (
                          <span className={styles.joinWhere}>(</span>
                        )))}
                        <button className={styles.addBtn} onClick={() => addToGroup(i)}>+ Add to group</button>
                      </div>
                    </div>
                  );
                })}
                <div className={styles.clauseRow}>
                  <button className={styles.addBtn} onClick={addFilter}>+ Add filter</button>
                  <button className={styles.addBtn} onClick={addGroup}>+ Add group</button>
                </div>
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

      {/* Group (board, table) */}
      {(isBoard || isTable) && (
        <div className={styles.control} ref={groupPop.ref}>
          <button className={`${styles.chip} ${s.group ? styles.chipActive : ""}`}
            onClick={() => groupPop.setOpen((o) => !o)}>
            Group{s.group ? ` · ${s.group}` : ""}
          </button>
          {groupPop.open && (
            <div className={styles.popover}>
              {isTable && (
                <button className={`${styles.optionBtn} ${!s.group ? styles.optionOn : ""}`} onClick={() => setGroup(null)}>
                  None{!s.group ? " ✓" : ""}
                </button>
              )}
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

      {/* Bucket — how a date group folds into sections */}
      {(isBoard || isTable) && s.group && (
        <div className={styles.control} ref={bucketPop.ref}>
          <button className={`${styles.chip} ${bucket ? styles.chipActive : ""}`}
            onClick={() => bucketPop.setOpen((o) => !o)}>
            By{bucket ? ` · ${bucket}` : ""}
          </button>
          {bucketPop.open && (
            <div className={styles.popover}>
              {["", "day", "week", "month", "quarter", "year"].map((b) => (
                <button key={b}
                  className={`${styles.optionBtn} ${bucket === b ? styles.optionOn : ""}`}
                  onClick={() => setBucket(b)}>
                  {b || "value"}{bucket === b ? " ✓" : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search — the rows shown, narrowed as you type. mod+f from the view
          lands here; inside the box it stays here (no find-in-note). */}
      {onSearchChange && (
        <div className={`${styles.search} ${query ? styles.searchActive : ""}`}>
          <SearchIcon size={12} />
          <input
            ref={searchRef}
            className={styles.searchInput}
            value={query}
            placeholder="Search rows…"
            spellCheck={false}
            data-find-scope
            aria-label="Search rows"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              const mod = isMac ? e.metaKey : e.ctrlKey;
              if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); e.currentTarget.select(); return; }
              if (e.key === "Escape") { e.preventDefault(); if (query) clearSearch(); else e.currentTarget.blur(); }
            }}
          />
          {query && (
            <button className={styles.searchClear} title="Clear search" onClick={clearSearch}>
              <CloseIcon size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
