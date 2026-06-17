// Notion-style property list for a note: one row per property — [type icon]
// [name] [value] — with colored chips for select/status/person/relation, and an
// "Add a property" footer. Schema-defined properties show in order (even when
// empty); any other frontmatter keys appear as inferred-type rows.

import { useState, useEffect, useRef } from "react";
import { commands, PropertyDef, PropType, SelectOption, TypeSchema } from "../../lib/commands";
import { SelectCell } from "./SelectCell";
import { Dropdown } from "./Dropdown";
import {
  CalendarIcon, CheckSquareIcon, SelectDotIcon, TagsListIcon, PersonIcon,
  LinkIcon, RelationIcon, TextLinesIcon, PlusIcon,
} from "./icons";
import styles from "./PropertiesPanel.module.css";

interface Props {
  frontmatter: Record<string, unknown>;
  notePath: string;
  onChange: (updated: Record<string, unknown>) => void;
}

// App-internal frontmatter that isn't a user-facing property.
const HIDDEN = new Set(["title", "type", "icon", "cover"]);

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
];

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
  if (typeof v === "boolean") return "checkbox";
  if (typeof v === "number") return "number";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return "date";
  return "text";
}

function PropIcon({ type }: { type: PropType }) {
  switch (type) {
    case "date": return <CalendarIcon size={15} />;
    case "checkbox": return <CheckSquareIcon size={15} />;
    case "select":
    case "status": return <SelectDotIcon size={15} />;
    case "multi_select": return <TagsListIcon size={15} />;
    case "person": return <PersonIcon size={15} />;
    case "url": return <LinkIcon size={15} />;
    case "relation": return <RelationIcon size={15} />;
    case "rollup": return <span className={styles.glyph}>Σ</span>;
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

export function PropertiesPanel({ frontmatter, notePath, onChange }: Props) {
  const [schema, setSchema] = useState<TypeSchema | null>(null);

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

  // Build the ordered property list: schema properties first (rollups excluded —
  // they're computed in data views), then any other frontmatter keys.
  const schemaProps = (schema?.properties ?? []).filter((p) => p.type !== "rollup");
  const schemaNames = new Set(schemaProps.map((p) => p.name));
  const items: Item[] = [
    ...schemaProps.map((p) => ({ name: p.name, type: p.type, options: p.options, def: p })),
    ...Object.keys(frontmatter)
      .filter((k) => !HIDDEN.has(k) && !schemaNames.has(k))
      .map((k) => ({ name: k, type: inferType(frontmatter[k]), options: [] as SelectOption[] })),
  ];

  return (
    <div className={styles.root}>
      <div className={styles.list}>
        {items.map((item) => (
          <div className={styles.propRow} key={item.name}>
            <div className={styles.propLabel}>
              <span className={styles.propIcon}><PropIcon type={item.type} /></span>
              <span className={styles.propName} title={item.name}>{item.name}</span>
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
              ) : (
                <ValueInput
                  value={frontmatter[item.name]}
                  type={item.type}
                  onCommit={(v) => set(item.name, v)}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <AddProperty onAdd={addProperty} />
    </div>
  );
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
