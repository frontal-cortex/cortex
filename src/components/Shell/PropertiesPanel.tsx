import { useState, useRef, KeyboardEvent } from "react";
import { PlusIcon, MinusIcon, CloseIcon } from "./icons";
import styles from "./PropertiesPanel.module.css";

interface Props {
  frontmatter: Record<string, unknown>;
  onChange: (updated: Record<string, unknown>) => void;
}

// Keys rendered with dedicated UI — everything else shows in the custom section
const KNOWN_KEYS = ["title", "type", "tags", "created"];

export function PropertiesPanel({ frontmatter, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);

  const set = (key: string, value: unknown) =>
    onChange({ ...frontmatter, [key]: value });

  const remove = (key: string) => {
    const next = { ...frontmatter };
    delete next[key];
    onChange(next);
  };

  const customEntries = Object.entries(frontmatter).filter(
    ([k]) => !KNOWN_KEYS.includes(k),
  );

  return (
    <div className={styles.root}>
      <div className={styles.row}>
        {/* Type */}
        <InlineField
          label="Type"
          value={typeof frontmatter["type"] === "string" ? frontmatter["type"] : ""}
          placeholder="note"
          onChange={(v) => set("type", v || "note")}
        />

        {/* Tags */}
        <TagsField
          tags={Array.isArray(frontmatter["tags"]) ? (frontmatter["tags"] as string[]) : []}
          onChange={(tags) => set("tags", tags)}
        />

        {/* Created (display only) */}
        {typeof frontmatter["created"] === "string" && (
          <span className={styles.created}>{frontmatter["created"]}</span>
        )}

        <button
          className={styles.expandBtn}
          onClick={() => setExpanded((x) => !x)}
          title="Toggle custom properties"
        >
          {expanded ? <MinusIcon size={13} /> : <PlusIcon size={13} />}
        </button>
      </div>

      {expanded && (
        <div className={styles.custom}>
          {customEntries.map(([key, val]) => (
            <div key={key} className={styles.customRow}>
              <span className={styles.customKey}>{key}</span>
              <input
                className={styles.customValue}
                value={typeof val === "string" ? val : JSON.stringify(val)}
                onChange={(e) => set(key, e.target.value)}
              />
              <button className={styles.removeBtn} onClick={() => remove(key)} title="Remove property">
                <CloseIcon size={12} />
              </button>
            </div>
          ))}
          <AddPropertyRow onAdd={(k, v) => set(k, v)} />
        </div>
      )}
    </div>
  );
}

function InlineField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        className={styles.fieldInput}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function TagsField({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setInputVal("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputVal);
    }
    if (e.key === "Backspace" && !inputVal && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className={styles.tagsField} onClick={() => inputRef.current?.focus()}>
      <span className={styles.fieldLabel}>Tags</span>
      <div className={styles.tagsInner}>
        {tags.map((tag) => (
          <span key={tag} className={styles.tag}>
            {tag}
            <button
              className={styles.tagRemove}
              onClick={(e) => {
                e.stopPropagation();
                onChange(tags.filter((t) => t !== tag));
              }}
              title="Remove tag"
            >
              <CloseIcon size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className={styles.tagInput}
          value={inputVal}
          placeholder={tags.length === 0 ? "Add tag…" : ""}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => inputVal.trim() && addTag(inputVal)}
        />
      </div>
    </div>
  );
}

function AddPropertyRow({ onAdd }: { onAdd: (key: string, val: string) => void }) {
  const [key, setKey] = useState("");
  const [val, setVal] = useState("");

  const submit = () => {
    if (key.trim()) {
      onAdd(key.trim(), val.trim());
      setKey("");
      setVal("");
    }
  };

  return (
    <div className={styles.customRow}>
      <input
        className={styles.customKey}
        value={key}
        placeholder="property"
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        style={{ minWidth: 80 }}
      />
      <input
        className={styles.customValue}
        value={val}
        placeholder="value"
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button className={styles.removeBtn} onClick={submit} style={{ color: "var(--accent)" }} title="Add property">
        <PlusIcon size={12} />
      </button>
    </div>
  );
}
