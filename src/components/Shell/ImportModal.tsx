// Import — the way in from somewhere else. Three sources, all ending in
// ordinary files: a CSV becomes rows of a collection (one note per record,
// typed frontmatter, the schema written or merged), a folder of Markdown —
// an Obsidian vault — is copied under notes/ with its images into assets/,
// and a Notion export zip becomes pages, collections and assets in one go
// with a report note of what could not be mapped. Every step before the
// Import button is a plan the Rust side computes without writing; the source
// is never modified.

import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  commands, CsvImportPlan, CsvImportReport, ImportColumn, MarkdownImportReport, NotionImportReport,
} from "../../lib/commands";
import { CloseIcon, DatabaseIcon, FolderIcon, FileIcon } from "./icons";
import styles from "./ImportModal.module.css";

interface Props {
  onClose: () => void;
  /** Files were written: refresh the tree, commit if auto-commit is on. */
  onChanged: () => void;
  onOpenNote: (path: string) => void;
}

type Kind = "csv" | "markdown" | "notion";

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

  // Notion
  const [notionPath, setNotionPath] = useState("");
  const [notionInto, setNotionInto] = useState("notion");
  const [notionPlan, setNotionPlan] = useState<NotionImportReport | null>(null);
  const [notionReport, setNotionReport] = useState<NotionImportReport | null>(null);

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

  // ── Notion: a dry run is the preview ────────────────────────────────────────
  useEffect(() => {
    if (kind !== "notion" || !notionPath || !notionInto.trim() || notionReport) return;
    let stale = false;
    setError(null);
    commands.importNotion(notionPath, notionInto.trim(), true)
      .then((r) => { if (!stale) setNotionPlan(r); })
      .catch((e) => { if (!stale) { setNotionPlan(null); setError(String(e)); } });
    return () => { stale = true; };
  }, [kind, notionPath, notionInto, notionReport]);

  const pickNotion = async (directory: boolean) => {
    const f = await openDialog(directory
      ? { directory: true, multiple: false, title: "Import an unpacked Notion export…" }
      : { multiple: false, directory: false, title: "Import a Notion export…", filters: [{ name: "Notion export", extensions: ["zip"] }] });
    if (!f || typeof f !== "string") return;
    setNotionPath(f);
    setNotionReport(null);
  };

  const runNotion = async () => {
    if (!notionPlan) return;
    setBusy(true);
    setError(null);
    try {
      const r = await commands.importNotion(notionPath, notionInto.trim(), false);
      setNotionReport(r);
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
  const notionCount = (r: NotionImportReport) => r.notes.length + r.collections.reduce((n, c) => n + c.written.length, 0);
  const notionReady = !!notionPlan && !busy && !notionReport && notionCount(notionPlan) > 0;

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
            <button role="tab" aria-selected={kind === "notion"} className={`${styles.kind} ${kind === "notion" ? styles.kindOn : ""}`} onClick={() => switchKind("notion")}>
              <DatabaseIcon size={14} /> Notion export
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

          {kind === "notion" && (
            <>
              <p className={styles.lead}>
                A Notion <em>Markdown &amp; CSV</em> export, the zip or its unpacked folder. Pages go under{" "}
                <code>notes/{notionInto.trim() || "<name>"}/</code> with Notion's hash suffixes stripped, every database becomes a
                collection with its schema inferred from the cells, links between pages become <code>[[Title]]</code>, images go to{" "}
                <code>assets/</code>, and an import report note lists what could not be mapped. Nothing already in the vault is overwritten.
              </p>

              <div className={styles.fields}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Export</span>
                  <span className={styles.fieldRow}>
                    <button className={styles.pick} onClick={() => pickNotion(false)}>{notionPath ? "Change…" : "Choose zip…"}</button>
                    <button className={styles.pick} onClick={() => pickNotion(true)}>Folder…</button>
                    <span className={styles.path} title={notionPath}>{notionPath ? baseName(notionPath) : "No export chosen"}</span>
                  </span>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Pages into</span>
                  <span className={styles.fieldRow}>
                    <span className={styles.prefix}>notes/</span>
                    <input className={styles.input} value={notionInto} placeholder="folder name" onChange={(e) => { setNotionInto(e.target.value); setNotionReport(null); }} spellCheck={false} />
                  </span>
                </label>
              </div>

              {(notionReport ?? notionPlan) && (
                <NotionSummary r={notionReport ?? notionPlan!} done={!!notionReport} onOpenNote={(p) => { onOpenNote(p); onClose(); }} />
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
              : kind === "markdown"
                ? (mdReport ? "Done." : "A dry run above; nothing is written until you press Import.")
                : (notionReport ? "Done." : "A dry run above; nothing is written until you press Import.")}
          </span>
          <button className={styles.cancel} onClick={onClose}>{csvReport || mdReport || notionReport ? "Close" : "Cancel"}</button>
          {kind === "csv" ? (
            <button className={styles.primary} disabled={!csvReady} onClick={runCsv}>
              {busy ? "Importing…" : plan ? `Import ${plan.rows - plan.skipped.length} row${plan.rows - plan.skipped.length === 1 ? "" : "s"}` : "Import"}
            </button>
          ) : kind === "markdown" ? (
            <button className={styles.primary} disabled={!mdReady} onClick={runMarkdown}>
              {busy ? "Importing…" : mdPlan ? `Import ${mdPlan.notes.length} note${mdPlan.notes.length === 1 ? "" : "s"}` : "Import"}
            </button>
          ) : (
            <button className={styles.primary} disabled={!notionReady} onClick={runNotion}>
              {busy ? "Importing…" : notionPlan ? `Import ${notionCount(notionPlan)} note${notionCount(notionPlan) === 1 ? "" : "s"}` : "Import"}
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
      <summary>{skipped.length} skipped{unresolved.length > 0 ? `, ${unresolved.length} reference${unresolved.length === 1 ? "" : "s"} left as written` : ""}</summary>
      <ul className={styles.list}>
        {skipped.map((s) => <li key={s.path}><span className={styles.mono}>{s.path}</span> <span className={styles.dim}>— {s.reason}</span></li>)}
        {unresolved.map((u) => <li key={`u:${u}`}><span className={styles.mono}>{u}</span> <span className={styles.dim}>— not found, left as written</span></li>)}
      </ul>
    </details>
  );
}

/** What a Notion import would write (a dry run), or did write. */
function NotionSummary({ r, done, onOpenNote }: { r: NotionImportReport; done: boolean; onOpenNote: (path: string) => void }) {
  const rows = r.collections.reduce((n, c) => n + c.written.length, 0);
  const verb = done ? "written" : "will be written";
  return (
    <section className={`${styles.section} ${done ? `${styles.outcome} ${styles.outcomeOk}` : ""}`}>
      <h3 className={styles.sectionTitle}>
        {r.notes.length} page{r.notes.length === 1 ? "" : "s"}, {rows} row{rows === 1 ? "" : "s"} in {r.collections.length} collection{r.collections.length === 1 ? "" : "s"} and {r.assets.length} image{r.assets.length === 1 ? "" : "s"} {verb}
      </h3>
      {r.collections.length > 0 && (
        <ul className={styles.list}>
          {r.collections.map((c) => (
            <li key={c.name}>
              <span className={styles.mono}>collections/{c.name}/</span>{" "}
              <span className={styles.dim}>— {c.title}: {c.written.length} of {c.rows} row{c.rows === 1 ? "" : "s"}{c.schema_added.length > 0 ? `; schema: ${c.schema_added.join(", ")}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {r.notes.length > 0 && (
        <ul className={styles.list}>
          {r.notes.slice(0, 30).map((n) => <li key={n} className={styles.mono}>{n}</li>)}
          {r.notes.length > 30 && <li className={styles.dim}>… and {r.notes.length - 30} more</li>}
        </ul>
      )}
      {r.unmapped.length > 0 && (
        <details className={styles.details}>
          <summary>{r.unmapped.length} thing{r.unmapped.length === 1 ? "" : "s"} could not be mapped exactly</summary>
          <ul className={styles.list}>
            {r.unmapped.map((u, i) => <li key={i}><span className={styles.mono}>{u.subject}</span> <span className={styles.dim}>— {u.detail}</span></li>)}
          </ul>
        </details>
      )}
      <SkippedList skipped={r.skipped} unresolved={r.unresolved} />
      {done && r.report && (
        <p className={styles.hint}>
          The details are in <button className={styles.link} onClick={() => onOpenNote(r.report!)}>{r.report}</button>.
        </p>
      )}
    </section>
  );
}
