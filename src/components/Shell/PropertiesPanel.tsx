// The note's metadata, under the title. Collapsed, it is one quiet line:
// created date, who last edited, and the properties that have values as
// chips. Expanded (click the line, or Ctrl+Shift+I), it is the Notion-style
// panel — one row per property: [type icon] [name] [value], coloured chips
// for select/status/person/relation, and an "Add a property" footer.
// Schema-defined properties show in order (even when empty); any other
// frontmatter keys appear as inferred-type rows.

import { useState, useEffect, useRef, ReactNode } from "react";
import { commands, Authorship, CommitEntry, PropertyDef, PropType, SelectOption, TypeSchema } from "../../lib/commands";
import { tagStyle, autoColor } from "../../lib/colors";
import { relativeTime } from "../../lib/fileTree";
import { shortcutFor } from "../../lib/keymap";
import { SelectCell } from "./SelectCell";
import { Dropdown } from "./Dropdown";
import { DatePicker } from "./DatePicker";
import { DateRangeInput, FilesInput, Ring, filesOf, formatRange, rangeOf } from "./PropertyInputs";
import {
  CalendarIcon, CheckSquareIcon, SelectDotIcon, TagsListIcon, PersonIcon,
  LinkIcon, RelationIcon, TextLinesIcon, PlusIcon, ChevronRightIcon, GlobeIcon, MoreIcon,
} from "./icons";
import styles from "./PropertiesPanel.module.css";

interface Props {
  frontmatter: Record<string, unknown>;
  notePath: string;
  /** Last commit touching this note, for the "edited by" text. */
  lastEdit?: CommitEntry | null;
  expanded: boolean;
  onToggle: () => void;
  onChange: (updated: Record<string, unknown>) => void;
  /** Open everything under a tag. Absent = the chips are not links. */
  onOpenTag?: (tag: string) => void;
}

// App-internal frontmatter that isn't a user-facing property.
const HIDDEN = new Set(["title", "type", "icon", "cover", "views", "parent", "width", "pack"]);
// Shown in the quiet line as prose ("Created 7 Sep 2026"), not as a chip.
const CREATED = "created";

/** "7 Sep 2026" from a YYYY-MM-DD (or fuller ISO) string; the raw text if not a date. */
function formatDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return v || null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function hasValue(v: unknown): boolean {
  if (v === undefined || v === null || v === "" || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

// Types a new note property can be (relation/rollup are configured in a table).
const ADD_TYPES: { value: PropType; label: string }[] = [
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

/** The git-derived types: read-only, computed per note (`note_authorship`). */
function isAuthorshipType(t: PropType): boolean {
  return t === "created_time" || t === "created_by" || t === "edited_time" || t === "edited_by";
}

function authorshipValue(a: Authorship | null, t: PropType): string {
  if (!a) return "";
  switch (t) {
    case "created_time": return a.created_at;
    case "created_by": return a.created_by;
    case "edited_time": return a.edited_at;
    case "edited_by": return a.edited_by;
    default: return "";
  }
}

/** "7 Sep 2026, 14:03" from a `YYYY-MM-DDTHH:MM` authorship time. */
function formatDateTime(v: string): string {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return v;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return m[4] ? `${day}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : day;
}

function schemaKeyFor(path: string, type: string | null): string | null {
  const m = path.match(/^collections\/([^/]+)/);
  if (m) return m[1];
  return type && type.length ? type : null;
}

function isSelectType(t: PropType): boolean {
  return t === "select" || t === "status" || t === "multi_select" || t === "person" || t === "relation";
}

function inferType(v: unknown): PropType {
  if (Array.isArray(v)) return "multi_select";
  if (rangeOf(v) && typeof v === "object") return "date_range";
  if (typeof v === "boolean") return "checkbox";
  if (typeof v === "number") return "number";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return "date";
  return "text";
}

function PropIcon({ type }: { type: PropType }) {
  switch (type) {
    case "date":
    case "date_range": return <CalendarIcon size={15} />;
    case "created_time":
    case "edited_time": return <span className={styles.glyph}>⏱</span>;
    case "created_by":
    case "edited_by": return <PersonIcon size={15} />;
    case "files": return <span className={styles.glyph}>📎</span>;
    case "checkbox": return <CheckSquareIcon size={15} />;
    case "select":
    case "status": return <SelectDotIcon size={15} />;
    case "multi_select": return <TagsListIcon size={15} />;
    case "person": return <PersonIcon size={15} />;
    case "url": return <LinkIcon size={15} />;
    case "relation": return <RelationIcon size={15} />;
    case "rollup": return <span className={styles.glyph}>Σ</span>;
    case "formula": return <span className={styles.glyph}>ƒ</span>;
    case "number": return <span className={styles.glyph}>#</span>;
    default: return <TextLinesIcon size={15} />;
  }
}

interface Item {
  name: string;
  type: PropType;
  options: SelectOption[];
  def?: PropertyDef;
}

export function PropertiesPanel({ frontmatter, notePath, lastEdit, expanded, onToggle, onChange, onOpenTag }: Props) {
  const [schema, setSchema] = useState<TypeSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authorship, setAuthorship] = useState<Authorship | null>(null);

  const noteType = typeof frontmatter["type"] === "string" ? (frontmatter["type"] as string) : null;
  const schemaKey = schemaKeyFor(notePath, noteType);

  const loadSchema = () =>
    commands.getSchemaForNote(notePath, noteType).then(setSchema).catch(() => setSchema(null));
  useEffect(() => {
    let alive = true;
    commands.getSchemaForNote(notePath, noteType)
      .then((s) => { if (alive) setSchema(s); })
      .catch(() => { if (alive) setSchema(null); });
    return () => { alive = false; };
  }, [notePath, noteType]);

  const set = (key: string, value: unknown) => {
    const next = { ...frontmatter };
    if (value === "" || value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  };

  const persistOptions = (prop: PropertyDef, options: SelectOption[]) => {
    if (!schemaKey) return;
    commands.upsertProperty(schemaKey, { ...prop, options }).then(loadSchema).catch(() => {});
  };

  const addProperty = (name: string, type: PropType) => {
    if (schemaKey) {
      commands.upsertProperty(schemaKey, { name, type, options: [] }).then(loadSchema).catch(() => {});
    } else {
      set(name, type === "checkbox" ? false : "");
    }
  };

  // Rename / delete a property. With a schema key the engine rewrites the
  // schema, every row (or every note of this type), the views and dependent
  // rollups / formulas; this note's own frontmatter is updated in place too so
  // the panel does not wait for the watcher. Without one, only this note changes.
  const renameProperty = (item: Item, name: string) => {
    if (!name || name === item.name) return;
    const local = () => {
      const next = { ...frontmatter };
      if (item.name in next) { next[name] = next[item.name]; delete next[item.name]; }
      onChange(next);
    };
    setError(null);
    if (schemaKey) commands.renameProperty(schemaKey, item.name, name).then(() => { local(); loadSchema(); }).catch((e) => setError(String(e)));
    else local();
  };
  const deleteProperty = (item: Item) => {
    const local = () => { const next = { ...frontmatter }; delete next[item.name]; onChange(next); };
    setError(null);
    if (!schemaKey) { local(); return; }
    if (!window.confirm(`Delete "${item.name}" from every ${schemaKey} note?`)) return;
    commands.deleteProperty(schemaKey, item.name).then(() => { local(); loadSchema(); }).catch((e) => setError(String(e)));
  };

  // Build the ordered property list: schema properties first, then any other
  // frontmatter keys. Computed properties — rollups, formulas, the reverse side
  // of a relation — are never in the frontmatter and only exist in data views,
  // so they are left out rather than shown as empty inputs. The git-derived
  // ones (created / edited time and by) are shown read-only, from the note's
  // own history.
  // A collection's own page is not one of its rows: its frontmatter is the
  // page's bookkeeping (views, icon, parent), so the row schema does not apply.
  const isCollectionPage = frontmatter["type"] === "database";
  const schemaProps = (isCollectionPage ? [] : schema?.properties ?? []).filter(
    (p) => p.type !== "rollup" && p.type !== "formula" && !(p.type === "relation" && p.from),
  );
  const wantsAuthorship = expanded && schemaProps.some((p) => isAuthorshipType(p.type));
  useEffect(() => {
    if (!wantsAuthorship) { setAuthorship(null); return; }
    let alive = true;
    commands.noteAuthorship(notePath)
      .then((a) => { if (alive) setAuthorship(a); })
      .catch(() => { if (alive) setAuthorship(null); });
    return () => { alive = false; };
  }, [wantsAuthorship, notePath, lastEdit]);
  const schemaNames = new Set(schemaProps.map((p) => p.name));
  const items: Item[] = [
    ...schemaProps.map((p) => ({ name: p.name, type: p.type, options: p.options ?? [], def: p })),
    ...Object.keys(frontmatter)
      .filter((k) => !HIDDEN.has(k) && !schemaNames.has(k))
      .map((k) => ({ name: k, type: inferType(frontmatter[k]), options: [] as SelectOption[] })),
  ];

  // The quiet line: what a reader wants to know about the note at a glance.
  const chips: ReactNode[] = [];
  if (frontmatter["publish"] === true) {
    chips.push(
      <span key="publish" className={`${styles.chip} ${styles.chipPublic}`} title="Marked for publishing (publish: true). Goes on the site the next time you publish.">
        <GlobeIcon size={10} /> Public
      </span>,
    );
  }
  for (const item of items) {
    if (item.name === CREATED || item.name === "publish") continue;
    const v = frontmatter[item.name];
    if (!hasValue(v)) continue;
    const colorFor = (name: string) => item.options.find((o) => o.name === name)?.color ?? autoColor(name);
    if (Array.isArray(v)) {
      for (const entry of v) {
        const name = String(entry);
        // A tag is the one chip that leads somewhere: everything filed under it.
        chips.push(item.name === "tags" && onOpenTag
          ? <button key={`${item.name}:${name}`} className={`${styles.chip} ${styles.chipLink}`} style={tagStyle(colorFor(name))}
              title={`Everything tagged #${name}`} onClick={() => onOpenTag(name)}>{name}</button>
          : <span key={`${item.name}:${name}`} className={styles.chip} style={tagStyle(colorFor(name))} title={item.name}>{name}</span>);
      }
    } else if (isSelectType(item.type)) {
      const name = String(v);
      chips.push(<span key={item.name} className={styles.chip} style={tagStyle(colorFor(name))} title={item.name}>{name}</span>);
    } else if (item.type === "checkbox") {
      chips.push(<span key={item.name} className={`${styles.chip} ${styles.chipKV}`}>✓ {item.name}</span>);
    } else if (isAuthorshipType(item.type)) {
      continue; // computed: the quiet line already says who edited and when
    } else {
      const text = item.type === "date" ? formatDate(v) ?? String(v)
        : item.type === "date_range" || (typeof v === "object" && v !== null) ? formatRange(v) || String(v)
        : item.type === "files" ? `${filesOf(v).length} file${filesOf(v).length === 1 ? "" : "s"}`
        : String(v);
      chips.push(
        <span key={item.name} className={`${styles.chip} ${styles.chipKV}`} title={`${item.name}: ${text}`}>
          <span className={styles.chipName}>{item.name}</span>{text}
        </span>,
      );
    }
  }
  const created = formatDate(frontmatter[CREATED]);
  const edited = lastEdit?.author ? `Edited by ${lastEdit.author} · ${relativeTime(lastEdit.timestamp)}` : null;
  const emptyLine = !created && !edited && chips.length === 0;
  const hint = expanded ? "Hide properties" : emptyLine ? "Add a property" : "Properties";

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={`${styles.meta} ${expanded ? styles.metaOpen : ""}`}
        onClick={onToggle}
        aria-expanded={expanded}
        title={`${expanded ? "Hide" : "Show"} properties (${shortcutFor("toggle-properties")})`}
      >
        {created && <span className={styles.metaText}>Created {created}</span>}
        {edited && <span className={styles.metaText}>{edited}</span>}
        {chips}
        <span className={styles.metaHint}>
          {emptyLine && !expanded
            ? <PlusIcon size={11} />
            : <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`}><ChevronRightIcon size={11} /></span>}
          {hint}
        </span>
      </button>

      {expanded && <div className={styles.panel}>
      <div className={styles.list}>
        {items.map((item) => (
          <div className={styles.propRow} key={item.name}>
            <div className={styles.propLabel}>
              <span className={styles.propIcon}><PropIcon type={item.type} /></span>
              <span className={styles.propName} title={item.name}>{item.name}</span>
              <PropMenu name={item.name} onRename={(n) => renameProperty(item, n)} onDelete={() => deleteProperty(item)} />
            </div>
            <div className={styles.propValue}>
              {isSelectType(item.type) ? (
                <SelectCell
                  value={frontmatter[item.name] as string | string[] | null | undefined}
                  options={item.options}
                  multi={item.type === "multi_select" || item.type === "relation"}
                  placeholder={item.type === "person" ? "Unassigned" : item.type === "relation" ? "Link…" : "Empty"}
                  onChange={(next) => set(item.name, next)}
                  onOptionsChange={
                    item.def && schemaKey && item.type !== "person" && item.type !== "relation"
                      ? (opts) => persistOptions(item.def!, opts)
                      : undefined
                  }
                />
              ) : item.type === "checkbox" ? (
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={frontmatter[item.name] === true}
                  onChange={(e) => set(item.name, e.target.checked)}
                />
              ) : item.type === "date" ? (
                <DatePicker
                  value={frontmatter[item.name] == null ? "" : String(frontmatter[item.name])}
                  placeholder="Empty"
                  inputClassName={styles.valueInput}
                  onChange={(v) => set(item.name, v || undefined)}
                />
              ) : item.type === "date_range" ? (
                <DateRangeInput
                  value={frontmatter[item.name]}
                  inputClassName={styles.valueInput}
                  onChange={(r) => set(item.name, r ?? undefined)}
                />
              ) : item.type === "files" ? (
                <FilesInput
                  value={frontmatter[item.name]}
                  editable
                  onChange={(next) => set(item.name, next)}
                />
              ) : isAuthorshipType(item.type) ? (
                <span className={styles.readonly} title="Computed from git history; never written to the note">
                  {(() => { const v = authorshipValue(authorship, item.type); return v ? (item.type.endsWith("_time") ? formatDateTime(v) : v) : "—"; })()}
                </span>
              ) : (
                <span className={styles.numberRow}>
                  {item.def?.format === "ring" && typeof frontmatter[item.name] === "number" && (
                    <Ring inside pct={ringPct(frontmatter[item.name] as number, item.def)} text={ringText(frontmatter[item.name] as number, item.def)} />
                  )}
                  <ValueInput
                    value={frontmatter[item.name]}
                    type={item.type}
                    onCommit={(v) => set(item.name, v)}
                  />
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}
      <AddProperty onAdd={addProperty} />
      </div>}
    </div>
  );
}

/** Where a number sits between its property's min and max (0–100 by default), unclamped. */
function ringPct(n: number, def: PropertyDef): number {
  const lo = def.min ?? 0, hi = def.max ?? 100;
  return hi > lo ? ((n - lo) / (hi - lo)) * 100 : 0;
}

/** The text inside a ring: the bare share, or the value with its unit. */
function ringText(n: number, def: PropertyDef): string {
  const bare = def.min === undefined && def.max === undefined && !def.unit;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return bare ? `${s}%` : `${s}${def.unit ?? ""}`;
}

function ValueInput({ value, type, onCommit }: {
  value: unknown;
  type: PropType;
  onCommit: (v: unknown) => void;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => { setDraft(value == null ? "" : String(value)); }, [value]);

  const commit = () => {
    const t = draft.trim();
    if (t === "") { onCommit(undefined); return; }
    if (type === "number") {
      const n = parseFloat(t);
      onCommit(Number.isNaN(n) ? t : n);
    } else {
      onCommit(t);
    }
  };

  return (
    <input
      className={styles.valueInput}
      value={draft}
      placeholder="Empty"
      inputMode={type === "number" ? "decimal" : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

/** "⋯" on a property row: rename (inline) or delete the property. */
function PropMenu({ name, onRename, onDelete }: { name: string; onRename: (name: string) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  useEffect(() => { if (!open) setRenaming(false); }, [open]);

  const commit = (raw: string) => {
    const next = raw.trim();
    setRenaming(false);
    if (next && next !== name) { setOpen(false); onRename(next); }
  };

  return (
    <div className={styles.propMenu} ref={ref}>
      <button type="button" className={styles.propMenuBtn} title="Property options" onClick={() => setOpen((o) => !o)}>
        <MoreIcon size={13} />
      </button>
      {open && (
        <div className={styles.propMenuList}>
          <button type="button" className={styles.propMenuItem} onClick={() => setRenaming((r) => !r)}>Rename…</button>
          {renaming && (
            <input
              className={styles.addPropInput}
              autoFocus
              defaultValue={name}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
                if (e.key === "Escape") setRenaming(false);
              }}
              onBlur={(e) => commit(e.target.value)}
            />
          )}
          <button type="button" className={`${styles.propMenuItem} ${styles.propMenuDanger}`} onClick={() => { setOpen(false); onDelete(); }}>
            Delete property
          </button>
        </div>
      )}
    </div>
  );
}

function AddProperty({ onAdd }: { onAdd: (name: string, type: PropType) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<PropType>("text");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onAdd(n, type);
    setName(""); setType("text"); setOpen(false);
  };

  return (
    <div className={styles.addProp} ref={ref}>
      <button className={styles.addPropBtn} onClick={() => setOpen((o) => !o)}>
        <PlusIcon size={13} /> Add a property
      </button>
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
            options={ADD_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            onChange={(v) => setType(v as PropType)}
          />
          <button className={styles.addPropConfirm} onClick={submit}>Add</button>
        </div>
      )}
    </div>
  );
}
