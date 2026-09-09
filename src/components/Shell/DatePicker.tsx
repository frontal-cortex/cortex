// A date field that is still a text field. Typed input is welcome — it is the
// fastest way to enter a date — but what lands in the file is always a real
// calendar day in `YYYY-MM-DD` (2026-13-45 is refused, not written). The
// calendar popover is the other way in: click a day, or steer with the
// keyboard (arrows move a day / a week, PageUp/PageDown a month, Enter picks).
//
// Used by the data table's date cells, the properties panel and the calendar
// view's "New row", so a date is entered the same way everywhere.

import { useEffect, useRef, useState, KeyboardEvent as ReactKeyboardEvent } from "react";
import { CalendarIcon } from "./icons";
import styles from "./DatePicker.module.css";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` for a local Date. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The calendar day a typed value names — `2026-9-8` and `2026-09-08` both
 *  become `2026-09-08`; an ISO date-time keeps its time part. Null when the
 *  text is not a date or names a day that does not exist (2026-02-30). */
export function normalizeDate(text: string): string | null {
  const m = text.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(T\S+)?$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  if (d > new Date(y, mo, 0).getDate()) return null;
  return `${m[1]}-${pad(mo)}-${pad(d)}${m[4] ?? ""}`;
}

function parseYmd(s: string): Date | null {
  const n = normalizeDate(s);
  if (!n) return null;
  return new Date(Number(n.slice(0, 4)), Number(n.slice(5, 7)) - 1, Number(n.slice(8, 10)));
}

interface Props {
  /** The stored value: "" or a date string. */
  value: string;
  /** A valid, normalised date — or "" to clear. Never called with junk. */
  onChange: (next: string) => void;
  /** Escape in the field, or a blur with nothing to commit. */
  onCancel?: () => void;
  /** Focus the field and open the calendar right away (a table cell being edited). */
  autoFocus?: boolean;
  placeholder?: string;
  /** Extra class for the text input, so a host can lend it its own field look. */
  inputClassName?: string;
}

export function DatePicker({ value, onChange, onCancel, autoFocus, placeholder = "YYYY-MM-DD", inputClassName }: Props) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(!!autoFocus);
  const [invalid, setInvalid] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // The month on show; the day that carries focus inside the grid.
  const anchor = parseYmd(value) ?? new Date();
  const [view, setView] = useState(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const [cursor, setCursor] = useState<string>(ymd(anchor));

  useEffect(() => { setDraft(value); setInvalid(false); }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Moving the cursor moves DOM focus with it once the grid is on screen.
  useEffect(() => {
    if (!open) return;
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`button[data-day="${cursor}"]`);
    if (el && gridRef.current?.contains(document.activeElement)) el.focus();
  }, [open, cursor, view]);

  const pick = (day: string) => {
    setDraft(day);
    setInvalid(false);
    setOpen(false);
    onChange(day);
    inputRef.current?.focus();
  };

  /** Commit what was typed: a real day, or empty to clear; else flag it and keep typing. */
  const commitDraft = (): boolean => {
    const t = draft.trim();
    if (t === "") { setInvalid(false); if (value !== "") onChange(""); else onCancel?.(); return true; }
    const n = normalizeDate(t);
    if (!n) { setInvalid(true); return false; }
    setInvalid(false);
    setDraft(n);
    if (n !== value) onChange(n); else onCancel?.();
    return true;
  };

  const showMonth = (d: Date) => setView(new Date(d.getFullYear(), d.getMonth(), 1));
  const moveCursor = (days: number, months = 0) => {
    const c = parseYmd(cursor) ?? new Date();
    const next = new Date(c.getFullYear(), c.getMonth() + months, c.getDate() + days);
    setCursor(ymd(next));
    showMonth(next);
  };
  const openGrid = () => {
    const d = parseYmd(draft) ?? parseYmd(value) ?? new Date();
    setCursor(ymd(d));
    showMonth(d);
    setOpen(true);
    // Hand focus to the grid on the next frame, once it exists.
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`button[data-day="${ymd(d)}"]`)?.focus());
  };

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (commitDraft()) setOpen(false); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); setDraft(value); setInvalid(false); onCancel?.(); }
    else if (e.key === "ArrowDown" || (e.altKey && e.key === "ArrowUp")) { e.preventDefault(); e.stopPropagation(); openGrid(); }
  };

  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    let handled = true;
    switch (e.key) {
      case "ArrowLeft": case "h": moveCursor(-1); break;
      case "ArrowRight": case "l": moveCursor(1); break;
      case "ArrowUp": case "k": moveCursor(-7); break;
      case "ArrowDown": case "j": moveCursor(7); break;
      case "PageUp": moveCursor(0, -1); break;
      case "PageDown": moveCursor(0, 1); break;
      case "Home": { const c = parseYmd(cursor) ?? new Date(); moveCursor(-((c.getDay() + 6) % 7)); break; }
      case "End": { const c = parseYmd(cursor) ?? new Date(); moveCursor(6 - ((c.getDay() + 6) % 7)); break; }
      case "t": pick(ymd(new Date())); break;
      case "Enter": case " ": pick(cursor); break;
      case "Escape": setOpen(false); inputRef.current?.focus(); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  // Leaving the whole control (input + popover) commits a typed day, so a Tab
  // away behaves like Enter; junk is dropped rather than written.
  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (wrapRef.current?.contains(e.relatedTarget as Node)) return;
    setOpen(false);
    const t = draft.trim();
    if (t !== "" && !normalizeDate(t)) { setDraft(value); setInvalid(false); onCancel?.(); return; }
    commitDraft();
  };

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const todayStr = ymd(new Date());
  const selected = normalizeDate(value)?.slice(0, 10) ?? "";

  return (
    <div className={styles.wrap} ref={wrapRef} onBlur={onBlur}>
      <div className={`${styles.field} ${invalid ? styles.fieldInvalid : ""}`}>
        <input
          ref={inputRef}
          className={`${styles.input} ${inputClassName ?? ""}`}
          value={draft}
          placeholder={placeholder}
          spellCheck={false}
          autoFocus={autoFocus}
          inputMode="numeric"
          aria-invalid={invalid || undefined}
          title={invalid ? "Not a date — use YYYY-MM-DD" : "Type a date, or ↓ for the calendar"}
          onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
          onKeyDown={onInputKey}
        />
        <button
          type="button"
          className={styles.toggle}
          tabIndex={-1}
          title="Pick a date"
          aria-label="Pick a date"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open ? setOpen(false) : openGrid())}
        >
          <CalendarIcon size={13} />
        </button>
      </div>
      {open && (
        <div className={styles.popover}>
          <div className={styles.header}>
            <button type="button" className={styles.nav} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => showMonth(new Date(year, month - 1, 1))} aria-label="Previous month">‹</button>
            <span className={styles.title}>{MONTHS[month]} {year}</span>
            <button type="button" className={styles.nav} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => showMonth(new Date(year, month + 1, 1))} aria-label="Next month">›</button>
          </div>
          <div className={styles.grid} ref={gridRef} onKeyDown={onGridKey} role="grid" aria-label="Calendar — arrows move, Enter picks, t for today">
            {WEEKDAYS.map((w) => <span key={w} className={styles.weekday}>{w}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={i} />;
              const key = ymd(d);
              return (
                <button
                  key={key}
                  type="button"
                  data-day={key}
                  tabIndex={key === cursor ? 0 : -1}
                  className={`${styles.day} ${key === selected ? styles.daySelected : ""} ${key === todayStr ? styles.dayToday : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(key)}
                  onFocus={() => setCursor(key)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className={styles.footer}>
            <button type="button" className={styles.footerBtn} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(todayStr)}>Today</button>
            {value !== "" && (
              <button type="button" className={styles.footerBtn} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => { setDraft(""); setOpen(false); onChange(""); }}>Clear</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
