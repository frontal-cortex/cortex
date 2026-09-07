// A custom select — native <select> renders its option list via the OS, which
// can't be themed (hence the light system popup on a dark app). This is a
// button + styled popover that matches the rest of the UI.

import { useState, useRef, useEffect, ReactNode } from "react";
import styles from "./Dropdown.module.css";

export interface DropdownOption {
  value: string;
  label: string;
  /** Leading mark (a brand icon, a swatch). Shown in the menu and on the button. */
  icon?: ReactNode;
  /** Small pill after the label, e.g. "detected". */
  badge?: string;
  /** Muted trailing text, e.g. "not installed". */
  hint?: string;
  /** Listed but not selectable — the hint should say why. */
  disabled?: boolean;
  /** Draw a rule above this item (start of a group). */
  separator?: boolean;
}

interface Props {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Stretch to the container width (forms); default is inline/compact (toolbars). */
  fullWidth?: boolean;
  className?: string;
}

export function Dropdown({ value, options, onChange, placeholder, fullWidth, className }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`${styles.wrap} ${fullWidth ? styles.full : ""} ${className ?? ""}`} ref={ref}>
      <button type="button" className={styles.button} onClick={() => setOpen((o) => !o)}>
        {selected?.icon && <span className={styles.icon}>{selected.icon}</span>}
        <span className={selected ? styles.label : styles.placeholder}>
          {selected ? selected.label : (placeholder ?? "Select…")}
        </span>
        <span className={styles.caret}>▾</span>
      </button>
      {open && (
        <div className={styles.menu}>
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              className={`${styles.item} ${o.value === value ? styles.itemActive : ""} ${o.disabled ? styles.itemDisabled : ""} ${o.separator ? styles.itemSeparator : ""}`}
              disabled={o.disabled}
              title={o.disabled ? o.hint : undefined}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.icon && <span className={styles.icon}>{o.icon}</span>}
              <span className={styles.itemLabel}>{o.label}</span>
              {o.badge && <span className={styles.badge}>{o.badge}</span>}
              {o.hint && !o.badge && <span className={styles.hint}>{o.hint}</span>}
              {o.value === value && <span className={styles.check}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
