// Reusable colored-pill editor for select / multi-select / status properties.
// Used in BOTH the data-view cells and the note properties panel, so the two
// stay visually and behaviorally identical (Notion-style).
//
// - Renders the current value(s) as colored pills.
// - Click opens a popover: pick an existing option, type to create a new one
//   (auto-assigned a color), or clear.
// - `onChange` returns the new raw value (string for single, string[] for
//   multi); the parent decides how to persist it.
// - `onOptionsChange`, when provided, persists a newly created option back to
//   the schema so its color sticks next time.

import { useEffect, useRef, useState } from "react";
import { SelectOption } from "../../lib/commands";
import { tagStyle, swatchStyle, autoColor, TAG_COLORS } from "../../lib/colors";
import { CloseIcon } from "./icons";
import styles from "./SelectCell.module.css";

interface Props {
  value: string | string[] | number | boolean | null | undefined;
  options: SelectOption[];
  multi: boolean;
  editable?: boolean;
  placeholder?: string;
  onChange: (next: string | string[]) => void;
  onOptionsChange?: (next: SelectOption[]) => void;
  /** A host (the data table, on Enter) asks for the popover to open. */
  forceOpen?: boolean;
  /** The popover closed — the host may take focus back. */
  onClose?: () => void;
}

function asArray(value: Props["value"]): string[] {
  if (Array.isArray(value)) return value.filter((v) => v !== "");
  if (value === null || value === undefined || value === "") return [];
  return [String(value)];
}

export function SelectCell({
  value,
  options,
  multi,
  editable = true,
  placeholder = "Empty",
  onChange,
  onOptionsChange,
  forceOpen,
  onClose,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (forceOpen && editable) setOpen(true); }, [forceOpen, editable]);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) onClose?.();
    wasOpen.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = asArray(value);
  const colorFor = (name: string) =>
    options.find((o) => o.name === name)?.color ?? autoColor(name);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const commit = (next: string[]) => {
    onChange(multi ? next : (next[0] ?? ""));
    if (!multi) setOpen(false);
  };

  const toggle = (name: string) => {
    if (multi) {
      commit(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);
    } else {
      commit([name]);
    }
  };

  const ensureOption = (name: string) => {
    if (onOptionsChange && !options.some((o) => o.name === name)) {
      onOptionsChange([...options, { name, color: autoColor(name) }]);
    }
  };

  const addFromDraft = () => {
    const name = draft.trim();
    if (!name) return;
    ensureOption(name);
    toggle(name);
    setDraft("");
  };

  const setOptionColor = (name: string, color: string) => {
    if (onOptionsChange) {
      onOptionsChange(options.map((o) => (o.name === name ? { ...o, color } : o)));
    }
  };

  // Options offered in the dropdown: schema options first, plus any selected
  // value that isn't (yet) a schema option.
  const known = new Set(options.map((o) => o.name));
  const offered = [
    ...options,
    ...selected.filter((s) => !known.has(s)).map((s) => ({ name: s, color: colorFor(s) })),
  ];
  const query = draft.trim().toLowerCase();
  const matches = offered.filter((o) => o.name.toLowerCase().includes(query));
  const exact = offered.some((o) => o.name.toLowerCase() === query);

  if (!editable) {
    return (
      <span className={styles.pills}>
        {selected.length === 0 && <span className={styles.empty}>—</span>}
        {selected.map((name) => (
          <span key={name} className={styles.pill} style={tagStyle(colorFor(name))}>
            {name}
          </span>
        ))}
      </span>
    );
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.trigger} onClick={() => setOpen((o) => !o)} title="Edit">
        {selected.length === 0 && <span className={styles.placeholder}>{placeholder}</span>}
        {selected.map((name) => (
          <span key={name} className={styles.pill} style={tagStyle(colorFor(name))}>
            {name}
            {multi && (
              <button
                className={styles.pillX}
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  commit(selected.filter((s) => s !== name));
                }}
              >
                <CloseIcon size={10} />
              </button>
            )}
          </span>
        ))}
      </div>

      {open && (
        <div className={styles.popover}>
          <input
            className={styles.search}
            autoFocus
            value={draft}
            placeholder={multi ? "Search or add…" : "Search or add…"}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addFromDraft(); }
              if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
              if (e.key === "Tab") setOpen(false);
            }}
          />
          <div className={styles.optionList}>
            {!multi && selected.length > 0 && (
              <button className={styles.clearRow} onClick={() => commit([])}>
                Clear selection
              </button>
            )}
            {matches.map((o) => (
              <div key={o.name} className={styles.optionRow}>
                <button className={styles.optionMain} onClick={() => toggle(o.name)}>
                  <span className={styles.pill} style={tagStyle(o.color)}>{o.name}</span>
                  {selected.includes(o.name) && <span className={styles.check}>✓</span>}
                </button>
                {onOptionsChange && (
                  <div className={styles.swatches}>
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`${styles.swatch} ${o.color === c ? styles.swatchOn : ""}`}
                        style={swatchStyle(c)}
                        title={c}
                        onClick={() => setOptionColor(o.name, c)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {query && !exact && (
              <button className={styles.createRow} onClick={addFromDraft}>
                Create <span className={styles.pill} style={tagStyle(autoColor(draft.trim()))}>{draft.trim()}</span>
              </button>
            )}
            {matches.length === 0 && !query && (
              <div className={styles.hint}>No options yet — type to add one.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
