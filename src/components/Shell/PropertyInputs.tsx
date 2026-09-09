// Editors for the newer property types, shared by the data table's cells and
// the properties panel so both write the same shape:
//
//   date_range  `{start, end}` under one key — two date pickers.
//   files       a list of vault-relative paths — thumbnails for images, a
//               name chip for anything else, an upload button that stores the
//               file under `assets/` through `save_asset` (the same path the
//               editor's image drop uses).

import { useEffect, useRef, useState } from "react";
import { commands, DateRange } from "../../lib/commands";
import { DatePicker } from "./DatePicker";
import { CloseIcon, PlusIcon } from "./icons";
import styles from "./PropertyInputs.module.css";

// ── Date range ────────────────────────────────────────────────────────────────

/** A cell or frontmatter value as a range: the stored `{start, end}`, a plain
 *  day as a one-day range, else null. */
export function rangeOf(v: unknown): DateRange | null {
  if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as DateRange).start === "string") {
    const r = v as DateRange;
    return { start: r.start, end: r.end || undefined };
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return { start: v.slice(0, 10) };
  return null;
}

/** The end of a range, or its start for a one-day range. */
export function rangeEnd(r: DateRange): string {
  return r.end && r.end >= r.start ? r.end : r.start;
}

/** "2026-09-10 → 2026-09-12", or the one day. */
export function formatRange(v: unknown): string {
  const r = rangeOf(v);
  if (!r) return "";
  return r.end && r.end !== r.start ? `${r.start} → ${r.end}` : r.start;
}

/** Two date pickers; `onChange` gets the `{start, end}` object to store, or
 *  null when the start is cleared. The wire text a table cell commits is
 *  `formatRange` of it — the engine reads the first two days in the text.
 *  `onCancel` fires when focus leaves the whole control or on Escape — not
 *  when one picker is left for the other, so Tab reaches the end date. */
export function DateRangeInput({ value, autoFocus, inputClassName, onChange, onCancel }: {
  value: unknown;
  autoFocus?: boolean;
  inputClassName?: string;
  onChange: (next: DateRange | null) => void;
  onCancel?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const r = rangeOf(value);
  const start = r?.start ?? "";
  const end = r?.end ?? "";
  const emit = (s: string, e: string) => {
    if (!s) { onChange(null); return; }
    onChange(e && e !== s ? { start: s, end: e } : { start: s });
  };
  return (
    <div
      className={styles.range}
      ref={wrapRef}
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget as Node)) onCancel?.(); }}
      onKeyDownCapture={(e) => { if (e.key === "Escape") onCancel?.(); }}
    >
      <DatePicker value={start} autoFocus={autoFocus} placeholder="Start" inputClassName={inputClassName}
        onChange={(v) => emit(v, end)} />
      <span className={styles.rangeArrow}>→</span>
      <DatePicker value={end} placeholder="End" inputClassName={inputClassName}
        onChange={(v) => emit(start, v)} />
    </div>
  );
}

// ── Files ─────────────────────────────────────────────────────────────────────

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export function isImagePath(p: string): boolean {
  return IMAGE_EXT.test(p);
}

/** A cell or frontmatter value as a list of paths. */
export function filesOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter((s) => s.trim() !== "");
  if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function baseName(p: string): string {
  return p.replace(/\/$/, "").split("/").pop() ?? p;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Store a picked file under `assets/`; returns its vault-relative path. */
export async function saveFileAsset(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return commands.saveAsset(file.name, uint8ToBase64(bytes));
}

/** A thumbnail for an image path in the vault (read through `read_asset`). */
function Thumb({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    commands.readAsset(path).then((d) => { if (alive) setSrc(d); }).catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [path]);
  if (!src) return <span className={styles.fileName}>{baseName(path)}</span>;
  return <img src={src} className={styles.thumb} alt={baseName(path)} />;
}

/** The files as chips — thumbnails for images, names otherwise — with a
 *  remove cross per file and an add button when editable. Clicking a chip
 *  reveals the file in the OS file manager. */
export function FilesInput({ value, editable, compact, onChange }: {
  value: unknown;
  editable: boolean;
  /** Table cells: smaller thumbnails, the add button only on hover. */
  compact?: boolean;
  onChange: (next: string[]) => void;
}) {
  const files = filesOf(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true); setError(null);
    try {
      const added: string[] = [];
      for (const f of Array.from(list)) added.push(await saveFileAsset(f));
      onChange([...files, ...added]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className={`${styles.files} ${compact ? styles.filesCompact : ""}`} onClick={(e) => e.stopPropagation()}>
      {files.map((p, i) => (
        <span key={`${p}:${i}`} className={styles.file} title={p}>
          <button type="button" className={styles.fileOpen} onClick={() => commands.revealPath(p).catch(() => {})}>
            {isImagePath(p) ? <Thumb path={p} /> : <span className={styles.fileName}>{baseName(p)}</span>}
          </button>
          {editable && (
            <button type="button" className={styles.fileRemove} title="Remove" aria-label={`Remove ${baseName(p)}`}
              onClick={() => onChange(files.filter((_, j) => j !== i))}>
              <CloseIcon size={9} />
            </button>
          )}
        </span>
      ))}
      {editable && (
        <>
          <button type="button" className={styles.fileAdd} title="Add files" disabled={busy} onClick={() => inputRef.current?.click()}>
            <PlusIcon size={11} /> {busy ? "Saving…" : files.length === 0 ? "Add files" : ""}
          </button>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => pick(e.target.files)} />
        </>
      )}
      {!editable && files.length === 0 && <span className={styles.empty}>—</span>}
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
