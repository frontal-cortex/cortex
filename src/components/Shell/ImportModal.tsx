// Import — the way in from somewhere else. Two sources, both ending in
// ordinary files: a CSV becomes rows of a collection (one note per record,
// typed frontmatter, the schema written or merged), and a folder of Markdown
// — an Obsidian vault, a Notion export — is copied under notes/ with its
// images into assets/. Every step before the Import button is a plan the
// Rust side computes without writing; the source is never modified.

import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  commands, CsvImportPlan, CsvImportReport, ImportColumn, MarkdownImportReport,
} from "../../lib/commands";
import { CloseIcon, DatabaseIcon, FolderIcon, FileIcon } from "./icons";
import styles from "./ImportModal.module.css";

interface Props {
  onClose: () => void;
  /** Files were written: refresh the tree, commit if auto-commit is on. */
  onChanged: () => void;
  onOpenNote: (path: string) => void;
}

type Kind = "csv" | "markdown";

const TYPES = ["text", "number", "date", "checkbox", "select", "multi_select", "url"];

const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
const collectionName = (s: string) => s.toLowerCase().replace(/\.csv$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function ImportModal({ onClose, onChanged, onOpenNote }: Props) {
  const [kind, setKind] = useState<Kind>("csv");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CSV
  const [csvPath, setCsvPath] = useState("");
  const [collections, setCollections] = useState<string[]>([]);
  const [collection, setCollection] = useState("");
  const [titleColumn, setTitleColumn] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ImportColumn[]>([]);
  const [plan, setPlan] = useState<CsvImportPlan | null>(null);
  const [csvReport, setCsvReport] = useState<CsvImportReport | null>(null);

  // Markdown
  const [mdPath, setMdPath] = useState("");
  const [into, setInto] = useState("");
  const [mdPlan, setMdPlan] = useState<MarkdownImportReport | null>(null);
  const [mdReport, setMdReport] = useState<MarkdownImportReport | null>(null);

  useEffect(() => {
    commands.listCollections().then(setCollections).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // ── CSV: re-plan whenever an input changes ──────────────────────────────────
  useEffect(() => {
    if (kind !== "csv" || !csvPath || !collection.trim() || csvReport) return;
    let stale = false;
    setError(null);
    commands.importCsvPlan(csvPath, collection.trim(), titleColumn, overrides.length ? overrides : null)
      .then((p) => { if (!stale) setPlan(p); })
      .catch((e) => { if (!stale) { setPlan(null); setError(String(e)); } });
    return () => { stale = true; };
  }, [kind, csvPath, collection, titleColumn, overrides, csvReport]);

  const pickCsv = async () => {
    const f = await openDialog({ multiple: false, directory: false, title: "Import CSV…", filters: [{ name: "CSV", extensions: ["csv", "tsv", "txt"] }] });
    if (!f || typeof f !== "string") return;
    setCsvPath(f);
    setOverrides([]);
    setTitleColumn(null);
    setCsvReport(null);
    if (!collection) setCollection(collectionName(baseName(f)));
  };

  const setOverride = useCallback((header: string, patch: Partial<ImportColumn>) => {
    setOverrides((prev) => {
      const current = prev.find((o) => o.header === header)
        ?? plan?.columns.find((c) => c.header === header)
        ?? { header, property: "", type: "" };
      const next: ImportColumn = { header, property: current.property, type: current.type, ...patch };
      return [...prev.filter((o) => o.header !== header), next];
    });
  }, [plan]);

  const runCsv = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const r = await commands.importCsv(csvPath, collection.trim(), titleColumn, overrides.length ? overrides : null);
      setCsvReport(r);
      onChanged();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  // ── Markdown: a dry run is the preview ──────────────────────────────────────
  useEffect(() => {
    if (kind !== "markdown" || !mdPath || !into.trim() || mdReport) return;
    let stale = false;
    setError(null);
    commands.importMarkdown(mdPath, into.trim(), true)
      .then((r) => { if (!stale) setMdPlan(r); })
      .catch((e) => { if (!stale) { setMdPlan(null); setError(String(e)); } });
    return () => { stale = true; };
  }, [kind, mdPath, into, mdReport]);

  const pickFolder = async () => {
    const d = await openDialog({ directory: true, multiple: false, title: "Import a folder of Markdown…" });
    if (!d || typeof d !== "string") return;
    setMdPath(d);
    setMdReport(null);
    if (!into) setInto(baseName(d));
  };

  const runMarkdown = async () => {
    if (!mdPlan) return;
    setBusy(true);
    setError(null);
    try {
      const r = await commands.importMarkdown(mdPath, into.trim(), false);
      setMdReport(r);
      onChanged();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  const switchKind = (k: Kind) => { setKind(k); setError(null); };

  const previewKeys = plan
    ? Array.from(new Set(plan.preview.flatMap((r) => Object.keys(r.frontmatter)))).sort()
    : [];
  const cell = (v: unknown) => Array.isArray(v) ? v.join(", ") : v === undefined || v === null ? "" : String(v);

  const csvReady = !!plan && !busy && !csvReport && plan.rows - plan.skipped.length > 0;
  const mdReady = !!mdPlan && !busy && !mdReport && mdPlan.notes.length > 0;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-label="Import" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.headIcon}><DatabaseIcon size={15} /></span>
          <span className={styles.title}>Import</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)"><CloseIcon size={15} /></button>
        </div>

        <div className={styles.body}>
          <div className={styles.kinds} role="tablist">
            <button role="tab" aria-selected={kind === "csv"} className={`${styles.kind} ${kind === "csv" ? styles.kindOn : ""}`} onClick={() => switchKind("csv")}>
              <FileIcon size={14} /> CSV into a collection
            </button>
            <button role="tab" aria-selected={kind === "markdown"} className={`${styles.kind} ${kind === "markdown" ? styles.kindOn : ""}`} onClick={() => switchKind("markdown")}>
              <FolderIcon size={14} /> Folder of Markdown
            </button>
          </div>

          {kind === "csv" && (
            <>
              <p className={styles.lead}>
                Each record becomes a row note under <code>collections/{collection.trim() || "<name>"}/</code>, named from the
                title column, with the other columns as typed properties. The schema is written or merged; rows that already
                exist are skipped, never overwritten.
              </p>

              <div className={styles.fields}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>File</span>
                  <span className={styles.fieldRow}>
                    <button className={styles.pick} onClick={pickCsv}>{csvPath ? "Change…" : "Choose CSV…"}</button>
                    <span className={styles.path} title={csvPath}>{csvPath ? baseName(csvPath) : "No file chosen"}</span>
                  </span>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Collection</span>
                  <span className={styles.fieldRow}>
                    <input
                      className={styles.input}
                      list="import-collections"
                      value={collection}
                      placeholder="new or existing"
                      onChange={(e) => { setCollection(e.target.value); setCsvReport(null); }}
                      spellCheck={false}
                    />
                    <datalist id="import-collections">
                      {collections.map((c) => <option key={c} value={c} />)}
                    </datalist>
                    {plan && <span className={styles.tag}>{plan.exists ? "existing" : "new"}</span>}
                  </span>
                </label>
                {plan && (
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Title from</span>
                    <span className={styles.fieldRow}>
                      <select className={styles.select} value={plan.title_column} onChange={(e) => { setTitleColumn(e.target.value); setCsvReport(null); }}>
                        {plan.columns.map((c) => <option key={c.header} value={c.header}>{c.header}</option>)}
                      </select>
                    </span>
                  </label>
                )}
              </div>

              {plan && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>Columns</h3>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>Column</th><th>Property</th><th>Type</th><th>Options</th></tr>
                      </thead>
                      <tbody>
                        {plan.columns.map((c) => {
                          const isTitle = c.header === plan.title_column;
                          return (
                            <tr key={c.header} className={c.property ? "" : styles.rowOff}>
                              <td className={styles.mono}>{c.header}</td>
                              <td>
                                <input
                                  className={`${styles.input} ${styles.inputCell}`}
                                  value={c.property}
                                  placeholder="(skip)"
                                  disabled={isTitle}
                                  onChange={(e) => { setOverride(c.header, { property: e.target.value.trim() }); setCsvReport(null); }}
                                  spellCheck={false}
                                />
                              </td>
                              <td>
                                <select
                                  className={styles.select}
                                  value={c.type}
                                  disabled={isTitle || !c.property}
                                  onChange={(e) => { setOverride(c.header, { type: e.target.value }); setCsvReport(null); }}
                                >
                                  {[...new Set([...TYPES, c.type])].map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </td>
                              <td className={styles.dim}>{(c.options ?? []).join(", ")}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {plan.schema_added.length > 0 && (
                    <p className={styles.hint}>
                      Schema <code>.cortex/schemas/{plan.collection}.yaml</code> {plan.schema_exists ? "gains" : "is created with"}:{" "}
                      {plan.schema_added.join(", ")}.
                    </p>
                  )}
                </section>
              )}

              {plan && !csvReport && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>
                    First {plan.preview.length} of {plan.rows} row{plan.rows === 1 ? "" : "s"}
                    {plan.skipped.length > 0 && <span className={styles.dim}> · {plan.skipped.length} already exist and will be skipped</span>}
                  </h3>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>Path</th>{previewKeys.map((k) => <th key={k}>{k}</th>)}</tr>
                      </thead>
                      <tbody>
                        {plan.preview.map((r) => (
                          <tr key={r.path}>
                            <td className={styles.mono}>{r.path.replace(/^collections\//, "")}</td>
                            {previewKeys.map((k) => <td key={k}>{cell(r.frontmatter[k])}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {csvReport && (
                <section className={`${styles.section} ${styles.outcome} ${styles.outcomeOk}`}>
                  <p>
                    Wrote {csvReport.written.length} row{csvReport.written.length === 1 ? "" : "s"} to{" "}
                    <button className={styles.link} onClick={() => { onOpenNote(`collections/${csvReport.collection}/_index.md`); onClose(); }}>
                      collections/{csvReport.collection}/
                    </button>
                    {csvReport.index_created && " (new collection)"}
                    {csvReport.schema_added.length > 0 && `; schema: +${csvReport.schema_added.join(", +")}`}
                    {csvReport.skipped.length > 0 && `; ${csvReport.skipped.length} skipped (already there)`}.
                  </p>
                </section>
              )}
            </>
          )}

          {kind === "markdown" && (
            <>
              <p className={styles.lead}>
                Every <code>.md</code> file under the folder is copied to <code>notes/{into.trim() || "<name>"}/</code>, frontmatter and{" "}
                <code>[[links]]</code> kept as they are. Images the notes reference go to <code>assets/</code> and their paths are
                rewritten. <code>.obsidian/</code> and other dot-folders are skipped. The source folder is not modified.
              </p>

              <div className={styles.fields}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Folder</span>
                  <span className={styles.fieldRow}>
                    <button className={styles.pick} onClick={pickFolder}>{mdPath ? "Change…" : "Choose folder…"}</button>
                    <span className={styles.path} title={mdPath}>{mdPath || "No folder chosen"}</span>
                  </span>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Into</span>
                  <span className={styles.fieldRow}>
                    <span className={styles.prefix}>notes/</span>
                    <input className={styles.input} value={into} placeholder="folder name" onChange={(e) => { setInto(e.target.value); setMdReport(null); }} spellCheck={false} />
                  </span>
                </label>
              </div>

              {mdPlan && !mdReport && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>
                    {mdPlan.notes.length} note{mdPlan.notes.length === 1 ? "" : "s"} and {mdPlan.assets.length} image{mdPlan.assets.length === 1 ? "" : "s"} will be copied
                  </h3>
                  {mdPlan.notes.length > 0 && (
                    <ul className={styles.list}>
                      {mdPlan.notes.slice(0, 40).map((n) => <li key={n} className={styles.mono}>{n}</li>)}
                      {mdPlan.notes.length > 40 && <li className={styles.dim}>… and {mdPlan.notes.length - 40} more</li>}
                    </ul>
                  )}
                  <SkippedList skipped={mdPlan.skipped} unresolved={mdPlan.unresolved} />
                </section>
              )}

              {mdReport && (
                <section className={`${styles.section} ${styles.outcome} ${styles.outcomeOk}`}>
                  <p>
                    Copied {mdReport.notes.length} note{mdReport.notes.length === 1 ? "" : "s"} to <code>{mdReport.dest}/</code> and{" "}
                    {mdReport.assets.length} image{mdReport.assets.length === 1 ? "" : "s"} to <code>assets/</code>
                    {mdReport.skipped.length > 0 && `; ${mdReport.skipped.length} skipped`}.
                    {mdReport.notes[0] && <> <button className={styles.link} onClick={() => { onOpenNote(mdReport.notes[0]); onClose(); }}>Open the first one</button>.</>}
                  </p>
                  <SkippedList skipped={mdReport.skipped} unresolved={mdReport.unresolved} />
                </section>
              )}
            </>
          )}

          {error && (
            <section className={`${styles.section} ${styles.outcome} ${styles.outcomeError}`}>
              <p>{error}</p>
            </section>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.footHint}>
            {kind === "csv"
              ? (csvReport ? "Done." : "Nothing is written until you press Import.")
              : (mdReport ? "Done." : "A dry run above; nothing is written until you press Import.")}
          </span>
          <button className={styles.cancel} onClick={onClose}>{csvReport || mdReport ? "Close" : "Cancel"}</button>
          {kind === "csv" ? (
            <button className={styles.primary} disabled={!csvReady} onClick={runCsv}>
              {busy ? "Importing…" : plan ? `Import ${plan.rows - plan.skipped.length} row${plan.rows - plan.skipped.length === 1 ? "" : "s"}` : "Import"}
            </button>
          ) : (
            <button className={styles.primary} disabled={!mdReady} onClick={runMarkdown}>
              {busy ? "Importing…" : mdPlan ? `Import ${mdPlan.notes.length} note${mdPlan.notes.length === 1 ? "" : "s"}` : "Import"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SkippedList({ skipped, unresolved }: { skipped: { path: string; reason: string }[]; unresolved: string[] }) {
  if (skipped.length === 0 && unresolved.length === 0) return null;
  return (
    <details className={styles.details}>
      <summary>{skipped.length} skipped{unresolved.length > 0 ? `, ${unresolved.length} image reference${unresolved.length === 1 ? "" : "s"} not found` : ""}</summary>
      <ul className={styles.list}>
        {skipped.map((s) => <li key={s.path}><span className={styles.mono}>{s.path}</span> <span className={styles.dim}>— {s.reason}</span></li>)}
        {unresolved.map((u) => <li key={`u:${u}`}><span className={styles.mono}>{u}</span> <span className={styles.dim}>— image not found, left as written</span></li>)}
      </ul>
    </details>
  );
}
