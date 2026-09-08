// Marketplace — a full-window page in the Settings shell: nav left, content
// right. Cards for every pack the vault can see (bundled official ones plus
// the configured indexes), a pack page with the exact files an install would
// write, and Install / Update / Remove that never overwrite the user's own
// work. Nothing here fetches or installs on its own; every write is a click,
// and `.cortex/packs.yaml` records it so `cortex packs` sees the same state.

import { useCallback, useEffect, useMemo, useRef, useState, ReactNode, KeyboardEvent as ReactKeyboardEvent } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  commands, PackCatalog, PackEntry, Pack, PackPlan, PackText, PackKind, PackTier,
  PackInstallReport, PackUpdateReport, PackRemoveReport,
} from "../../lib/commands";
import { Dropdown } from "./Dropdown";
import {
  CloseIcon, SearchIcon, SyncIcon, TemplateIcon, DatabaseIcon, SparkleIcon, ChevronLeftIcon,
  OpenIcon, TagsListIcon, CheckSquareIcon, FolderIcon,
} from "./icons";
import styles from "./MarketplaceView.module.css";

interface Props {
  onClose: () => void;
  /** Files were written or removed — the sidebar should re-read the vault. */
  onChanged: () => void;
}

const MARKETPLACE_REPO = "https://github.com/frontal-cortex/marketplace";
const RECORD_FILE = ".cortex/packs.yaml";

// ── Filters ───────────────────────────────────────────────────────────────────
//
// The nav is a list of filters over one catalog: the fixed ones first, then
// by kind, then by tag. Search cuts across whichever is active.

type Filter = "all" | "installed" | "updates" | `kind:${PackKind}` | `tag:${string}`;

const KIND_LABEL: Record<PackKind, string> = { note: "Note templates", collection: "Databases", bundle: "Bundles" };
const KIND_ONE: Record<PackKind, string> = { note: "Note template", collection: "Database", bundle: "Bundle" };
const TIER_LABEL: Record<PackTier, string> = { official: "Official", verified: "Verified", community: "Community" };
const TIER_HINT: Record<PackTier, string> = {
  official: "Written or adopted by the Cortex team and bundled with the app.",
  verified: "Community pack whose content a maintainer reviewed against the checklist.",
  community: "Community pack that passed lint; a maintainer merged it without a content review.",
};

function matches(e: PackEntry, q: string): boolean {
  if (!q) return true;
  const hay = `${e.name} ${e.id} ${e.summary} ${e.tags.join(" ")} ${e.author.name} ${KIND_LABEL[e.kind]}`.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function passes(e: PackEntry, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "installed") return !!e.installed_version;
  if (f === "updates") return e.update_available;
  if (f.startsWith("kind:")) return e.kind === f.slice(5);
  if (f.startsWith("tag:")) return e.tags.includes(f.slice(4));
  return true;
}

// ── The page ──────────────────────────────────────────────────────────────────

export function MarketplaceView({ onClose, onChanged }: Props) {
  const [catalog, setCatalog] = useState<PackCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tier, setTier] = useState<"all" | PackTier>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const openIdRef = useRef(openId);
  openIdRef.current = openId;

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    try {
      setCatalog(await commands.packsCatalog(refresh));
      setLoadError(null);
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(false); }, [load]);

  // Escape backs out of a pack page first, then closes the marketplace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (query && document.activeElement === searchRef.current) { setQuery(""); return; }
      if (openIdRef.current) { setOpenId(null); return; }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, query]);

  const entries = catalog?.entries ?? [];
  const q = query.trim().toLowerCase();

  const counts = useMemo(() => ({
    all: entries.length,
    installed: entries.filter((e) => e.installed_version).length,
    updates: entries.filter((e) => e.update_available).length,
  }), [entries]);
  const kinds = useMemo(() => (["note", "collection", "bundle"] as PackKind[]).filter((k) => entries.some((e) => e.kind === k)), [entries]);
  const tags = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of entries) for (const t of e.tags) n.set(t, (n.get(t) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
  }, [entries]);

  const shown = useMemo(
    () => entries.filter((e) => passes(e, filter) && (tier === "all" || e.tier === tier) && matches(e, q)),
    [entries, filter, tier, q],
  );
  const featured = shown.filter((e) => e.featured);
  const rest = shown.filter((e) => !e.featured);
  const splitFeatured = filter === "all" && !q && featured.length > 0 && rest.length > 0;

  const openEntry = openId ? entries.find((e) => e.id === openId) ?? null : null;

  const pick = (f: Filter) => {
    setFilter(f);
    setOpenId(null);
    contentRef.current?.scrollTo({ top: 0 });
  };

  const onNavKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
    else if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
  };

  const navItem = (f: Filter, label: string, icon: ReactNode, count?: number) => (
    <button
      key={f}
      className={`${styles.navItem} ${filter === f && !q ? styles.navItemActive : ""}`}
      onClick={() => pick(f)}
    >
      <span className={styles.navIcon}>{icon}</span>
      <span className={styles.navLabel}>{label}</span>
      {count !== undefined && <span className={styles.navCount}>{count}</span>}
    </button>
  );

  const unreachable = catalog?.errors ?? [];

  return (
    <div className={styles.page} role="dialog" aria-label="Marketplace">
      <nav className={styles.nav}>
        <div className={styles.navHead}>
          <span className={styles.navTitle}>Marketplace</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)"><CloseIcon size={16} /></button>
        </div>
        <label className={styles.search}>
          <SearchIcon size={13} />
          <input
            ref={searchRef}
            className={styles.searchInput}
            value={query}
            autoFocus
            placeholder="Search templates"
            spellCheck={false}
            onChange={(e) => { setQuery(e.target.value); setOpenId(null); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                (e.currentTarget.closest("nav")?.querySelector(`.${styles.navList} button`) as HTMLButtonElement | null)?.focus();
              }
            }}
          />
          {!query && <span className={styles.searchKey}>/</span>}
        </label>
        <div className={styles.navList} role="list" onKeyDown={onNavKey}>
          {navItem("all", "All", <SparkleIcon size={14} />, counts.all)}
          {navItem("installed", "Installed", <CheckSquareIcon size={14} />, counts.installed)}
          {counts.updates > 0 && navItem("updates", "Updates", <SyncIcon size={14} />, counts.updates)}
          {kinds.length > 0 && <div className={styles.navGroup}>Kind</div>}
          {kinds.map((k) => navItem(`kind:${k}`, KIND_LABEL[k], k === "collection" ? <DatabaseIcon size={14} /> : k === "bundle" ? <FolderIcon size={14} /> : <TemplateIcon size={14} />, entries.filter((e) => e.kind === k).length))}
          {tags.length > 0 && <div className={styles.navGroup}>Tags</div>}
          {tags.map(([t, n]) => navItem(`tag:${t}`, t, <TagsListIcon size={14} />, n))}
        </div>
        <div className={styles.navFoot}>
          <Dropdown
            fullWidth
            value={tier}
            options={[
              { value: "all", label: "All tiers" },
              { value: "official", label: "Official only", hint: "bundled" },
              { value: "verified", label: "Verified", hint: "reviewed" },
              { value: "community", label: "Community", hint: "lint only" },
            ]}
            onChange={(v) => setTier(v as "all" | PackTier)}
          />
          <button className={styles.btn} onClick={() => load(true)} disabled={refreshing} title="Re-fetch the index; nothing is installed">
            <SyncIcon size={12} /> {refreshing ? "Refreshing…" : "Refresh index"}
          </button>
          {unreachable.length > 0 && (
            <span className={`${styles.note} ${styles.warn}`} title={unreachable.map(([u, e]) => `${u}: ${e}`).join("\n")}>
              The online index could not be reached; showing the packs bundled with the app.
            </span>
          )}
          {catalog?.fetched_at && <span className={styles.note}>Index from {catalog.fetched_at.slice(0, 10)}.</span>}
          <span className={styles.note}>
            Installed packs are recorded in <code>{RECORD_FILE}</code>. Same catalog from a terminal: <code>cortex packs list</code>.
          </span>
        </div>
      </nav>

      <div className={styles.content} ref={contentRef}>
        <div className={styles.inner}>
          {loadError ? (
            <div className={styles.empty}>Could not read the marketplace: {loadError}</div>
          ) : !catalog ? (
            <div className={styles.empty}>Loading…</div>
          ) : openEntry ? (
            <PackPage
              key={openEntry.id}
              entry={openEntry}
              onBack={() => setOpenId(null)}
              onChanged={() => { onChanged(); load(false); }}
            />
          ) : shown.length === 0 ? (
            <div className={styles.empty}>
              {q ? <>No templates match “{query}”.</>
                : filter === "installed" ? <>Nothing installed yet. Pick a pack and press Install; the files land in your vault as plain Markdown and YAML.</>
                : filter === "updates" ? <>Everything installed is up to date.</>
                : <>No packs here.</>}
            </div>
          ) : splitFeatured ? (
            <>
              <Grid title="Featured" blurb="The ten most-used templates, ready to install." entries={featured} onOpen={setOpenId} onChanged={() => { onChanged(); load(false); }} />
              <Grid title="Everything else" entries={rest} onOpen={setOpenId} onChanged={() => { onChanged(); load(false); }} />
            </>
          ) : (
            <Grid
              title={q ? `Results for “${query}”` : filter === "all" ? "All templates" : filter === "installed" ? "Installed" : filter === "updates" ? "Updates" : filter.startsWith("kind:") ? KIND_LABEL[filter.slice(5) as PackKind] : `#${filter.slice(4)}`}
              blurb={filter === "all" && !q ? "Note templates and databases, as Markdown and YAML — readable in any editor, never code." : undefined}
              entries={shown}
              onOpen={setOpenId}
              onChanged={() => { onChanged(); load(false); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function Grid({ title, blurb, entries, onOpen, onChanged }: {
  title: string; blurb?: string; entries: PackEntry[]; onOpen: (id: string) => void; onChanged: () => void;
}) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {blurb && <p className={styles.sectionBlurb}>{blurb}</p>}
      </div>
      <div className={styles.grid}>
        {entries.map((e) => <Card key={e.id} entry={e} onOpen={() => onOpen(e.id)} onChanged={onChanged} />)}
      </div>
    </section>
  );
}

function KindIcon({ kind, size = 14 }: { kind: PackKind; size?: number }) {
  return kind === "collection" ? <DatabaseIcon size={size} /> : kind === "bundle" ? <FolderIcon size={size} /> : <TemplateIcon size={size} />;
}

function TierBadge({ tier }: { tier: PackTier }) {
  return <span className={`${styles.tier} ${styles[`tier_${tier}`]}`} title={TIER_HINT[tier]}>{TIER_LABEL[tier]}</span>;
}

function Card({ entry, onOpen, onChanged }: { entry: PackEntry; onOpen: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const quickInstall = async (ev: React.MouseEvent) => {
    ev.stopPropagation();
    setBusy(true); setErr(null);
    try {
      if (entry.update_available) await commands.packsUpdate(entry.id);
      else await commands.packsInstall(entry.id, false);
      onChanged();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  };
  const state = entry.update_available ? "update" : entry.installed_version ? "installed" : "new";
  return (
    <div
      className={`${styles.card} ${entry.needs_newer_app ? styles.cardDim : ""}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
    >
      {entry.preview ? (
        <img className={styles.cardImage} src={entry.preview} alt="" loading="lazy" />
      ) : entry.excerpt && (entry.excerpt.properties.length > 0 || entry.excerpt.headings.length > 0) ? (
        <CardExcerpt entry={entry} />
      ) : (
        <div className={`${styles.cardImage} ${styles.cardGlyph}`}><KindIcon kind={entry.kind} size={22} /></div>
      )}
      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <span className={styles.cardName}>{entry.name}</span>
          <TierBadge tier={entry.tier} />
        </div>
        <p className={styles.cardSummary}>{entry.summary}</p>
        <div className={styles.cardMeta}>
          <span>{KIND_ONE[entry.kind]}</span>
          <span>·</span>
          <span>{entry.author.name || "unknown author"}</span>
          <span>·</span>
          <span className={styles.mono}>v{entry.version}</span>
        </div>
        <div className={styles.cardFoot}>
          <span className={styles.cardTags}>{entry.tags.slice(0, 3).map((t) => <span key={t} className={styles.tag}>{t}</span>)}</span>
          {entry.needs_newer_app ? (
            <span className={styles.note} title={`Needs Cortex ${entry.min_cortex ?? ""} or newer`}>Needs a newer app</span>
          ) : state === "installed" ? (
            <span className={styles.installedMark}><CheckSquareIcon size={12} /> Installed</span>
          ) : (
            <button className={`${styles.btn} ${state === "new" ? styles.btnPrimary : ""}`} disabled={busy} onClick={quickInstall}
              title={state === "update" ? `Update to v${entry.version}; files you edited are kept` : "Install into this vault; never overwrites your files"}>
              {busy ? "…" : state === "update" ? "Update" : "Install"}
            </button>
          )}
        </div>
        {err && <span className={`${styles.note} ${styles.warn}`}>{err}</span>}
      </div>
    </div>
  );
}

/** The card's picture when a pack ships none: a database's columns and views,
 *  or a template's headings — the pack's own shape, from the bundled copy. */
function CardExcerpt({ entry }: { entry: PackEntry }) {
  const ex = entry.excerpt!;
  if (ex.properties.length > 0) {
    return (
      <div className={`${styles.cardImage} ${styles.cardShape}`}>
        <div className={styles.shapeRow}>
          <span className={styles.shapeCell}>title</span>
          {ex.properties.slice(0, 4).map(([name]) => <span key={name} className={styles.shapeCell}>{name}</span>)}
          {ex.properties.length > 4 && <span className={styles.shapeMore}>+{ex.properties.length - 4}</span>}
        </div>
        <div className={styles.shapeViews}>{ex.views.map(([name, type]) => <span key={name} className={styles.view} title={type}>{name}</span>)}</div>
      </div>
    );
  }
  return (
    <div className={`${styles.cardImage} ${styles.cardShape}`}>
      {ex.headings.slice(0, 4).map((h, i) => <div key={i} className={styles.shapeHeading}>{h}</div>)}
      {ex.headings.length > 4 && <div className={styles.shapeMore}>+{ex.headings.length - 4} more</div>}
    </div>
  );
}

// ── Pack page ─────────────────────────────────────────────────────────────────

type Report =
  | { kind: "install"; reports: PackInstallReport[] }
  | { kind: "update"; report: PackUpdateReport }
  | { kind: "remove"; report: PackRemoveReport };

function PackPage({ entry, onBack, onChanged }: { entry: PackEntry; onBack: () => void; onChanged: () => void }) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [plan, setPlan] = useState<PackPlan | null>(null);
  const [texts, setTexts] = useState<PackText[]>([]);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<null | "install" | "update" | "remove">(null);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const load = useCallback(() => {
    commands.packsShow(entry.id, force).then(([p, pl]) => { setPack(p); setPlan(pl); setErr(null); }).catch((e) => setErr(String(e)));
    commands.packsFiles(entry.id).then(setTexts).catch(() => {});
  }, [entry.id, force]);
  useEffect(() => { load(); }, [load]);

  const run = async (what: "install" | "update" | "remove") => {
    setBusy(what); setErr(null); setReport(null);
    try {
      if (what === "install") setReport({ kind: "install", reports: await commands.packsInstall(entry.id, force) });
      else if (what === "update") setReport({ kind: "update", report: await commands.packsUpdate(entry.id) });
      else setReport({ kind: "remove", report: await commands.packsRemove(entry.id) });
      onChanged();
      load();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };

  const m = pack?.manifest;
  const installed = !!entry.installed_version;
  const skipped = plan?.steps.filter((s) => s.action === "skip") ?? [];
  const canForce = skipped.some((s) => s.dest.startsWith("templates/") || s.dest.startsWith(".cortex/schemas/"));
  const sourceUrl = entry.source === "bundled" || entry.source.startsWith("https://frontal-cortex.github.io/marketplace/")
    ? `${MARKETPLACE_REPO}/tree/main/packs/${entry.id}`
    : entry.source;

  return (
    <section className={styles.section} aria-label={entry.name}>
      <button className={styles.back} onClick={onBack}><ChevronLeftIcon size={13} /> All templates</button>
      <div className={styles.packHead}>
        <span className={styles.packGlyph}><KindIcon kind={entry.kind} size={20} /></span>
        <div className={styles.packTitle}>
          <h2 className={styles.sectionTitle}>{entry.name} <TierBadge tier={entry.tier} /></h2>
          <div className={styles.cardMeta}>
            <span>{KIND_ONE[entry.kind]}</span>
            <span>·</span>
            <span className={styles.mono}>v{entry.version}</span>
            {entry.installed_version && <><span>·</span><span>installed v{entry.installed_version}</span></>}
            <span>·</span>
            {entry.author.url ? (
              <button className={styles.link} onClick={() => openExternal(entry.author.url!).catch(() => {})}>{entry.author.name}</button>
            ) : <span>{entry.author.name}</span>}
          </div>
        </div>
        <div className={styles.packActions}>
          {entry.needs_newer_app ? (
            <span className={`${styles.note} ${styles.warn}`}>Needs Cortex {entry.min_cortex} or newer.</span>
          ) : (
            <>
              {!installed && (
                <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!!busy || !plan} onClick={() => run("install")}>
                  {busy === "install" ? "Installing…" : "Install"}
                </button>
              )}
              {installed && entry.update_available && (
                <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!!busy} onClick={() => run("update")} title="Files you edited are kept">
                  {busy === "update" ? "Updating…" : `Update to v${entry.version}`}
                </button>
              )}
              {installed && !entry.update_available && (
                <button className={styles.btn} disabled={!!busy || !plan} onClick={() => run("install")} title="Write back any of the pack's files that are missing or unchanged; your edits are kept">
                  {busy === "install" ? "Reinstalling…" : "Reinstall"}
                </button>
              )}
              {installed && (
                <button className={`${styles.btn} ${styles.btnDanger}`} disabled={!!busy} onClick={() => run("remove")} title="Deletes only the files the pack wrote that you have not changed">
                  {busy === "remove" ? "Removing…" : "Remove"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {err && <div className={`${styles.callout} ${styles.calloutWarn}`}>{err}</div>}
      {report && <ReportView report={report} />}

      <p className={styles.description}>{(m?.description || entry.description || entry.summary).trim()}</p>
      {entry.tags.length > 0 && <div className={styles.cardTags}>{entry.tags.map((t) => <span key={t} className={styles.tag}>{t}</span>)}</div>}

      <Preview entry={entry} texts={texts} />

      <h3 className={styles.h3}>What this installs</h3>
      {!plan ? (
        <span className={styles.note}>Working out the plan…</span>
      ) : plan.steps.length === 0 && entry.kind === "bundle" ? (
        <span className={styles.note}>A bundle installs the packs it includes: {m?.includes?.join(", ")}.</span>
      ) : (
        <ul className={styles.files}>
          {plan.steps.map((s) => (
            <li key={s.pack_path} className={styles.fileRow}>
              <code className={styles.filePath}>{s.dest}</code>
              <span className={`${styles.action} ${styles[`action_${s.action}`]}`}>
                {s.action === "write" ? "new" : s.action === "overwrite" ? (installed ? "replace (unchanged since install)" : "replace") : s.action === "merge" ? "merge properties into your schema" : `kept — ${s.reason}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canForce && !installed && (
        <label className={styles.check}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          Overwrite templates and schemas that are already there. Never touches a database row.
        </label>
      )}
      <span className={styles.note}>
        Every file is plain Markdown or YAML. An installed file you edit is yours: update and remove leave it alone.
      </span>

      <h3 className={styles.h3}>Licence and source</h3>
      <div className={styles.kv}>
        <span>Licence</span><span>{entry.license}</span>
        {entry.credits && <><span>Credits</span><span>{entry.credits}</span></>}
        <span>Source</span>
        <span>
          <button className={styles.link} onClick={() => openExternal(sourceUrl).catch(() => {})}>
            <OpenIcon size={11} /> {sourceUrl.replace(/^https?:\/\//, "")}
          </button>
        </span>
        <span>Terminal</span><span><code>cortex packs {installed ? "show" : "install"} {entry.id}</code></span>
      </div>
    </section>
  );
}

function ReportView({ report }: { report: Report }) {
  const line = (label: string, items: string[]) => items.length > 0 && (
    <div className={styles.reportLine}><span className={styles.reportLabel}>{label}</span><code className={styles.filePath}>{items.join("  ")}</code></div>
  );
  if (report.kind === "install") {
    const r = report.reports;
    const written = r.flatMap((x) => x.written), merged = r.flatMap((x) => x.merged), skipped = r.flatMap((x) => x.skipped);
    const nothing = written.length + merged.length === 0;
    return (
      <div className={styles.callout}>
        <strong>{nothing ? "Nothing to write — already installed." : `Installed ${r.map((x) => `${x.id} v${x.version}`).join(", ")}.`}</strong>
        {line("wrote", written)}
        {line("merged", merged)}
        {line("kept", skipped.map(([p, why]) => `${p} (${why})`))}
      </div>
    );
  }
  if (report.kind === "update") {
    const r = report.report;
    return (
      <div className={styles.callout}>
        <strong>Updated {r.id} {r.from} → {r.to}.</strong>
        {line("replaced", r.replaced)}
        {line("added", r.added)}
        {line("kept your version", r.kept)}
      </div>
    );
  }
  const r = report.report;
  return (
    <div className={styles.callout}>
      <strong>Removed {r.id}.</strong>
      {line("deleted", r.removed)}
      {line("kept (edited since install)", r.kept)}
    </div>
  );
}

// ── Preview: what the template or table looks like ───────────────────────────
//
// Packs are plain files, so the preview is the files themselves: a note
// pack shows the template's body; a database pack shows its columns and
// views from the schema and index.md. The tiny parsers below only need to
// understand the shapes lint already enforces.

function splitFrontmatter(text: string): { fm: string; body: string } {
  if (!text.startsWith("---")) return { fm: "", body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { fm: "", body: text };
  return { fm: text.slice(3, end), body: text.slice(end + 4).replace(/^\r?\n/, "") };
}

function listOf(yaml: string, key: string): { name: string; type: string; options: string[] }[] {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => l.trim() === `${key}:`);
  if (start < 0) return [];
  const out: { name: string; type: string; options: string[] }[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const m = l.match(/^\s*-\s+name:\s*(.+)$/);
    if (m) { out.push({ name: unquote(m[1]), type: "", options: [] }); continue; }
    const t = l.match(/^\s+type:\s*(.+)$/);
    if (t && out.length) { if (!out[out.length - 1].type) out[out.length - 1].type = unquote(t[1]); continue; }
    const o = l.match(/^\s+-\s+name:\s*(.+)$/);
    if (o && out.length) out[out.length - 1].options.push(unquote(o[1]));
  }
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t;
}

function Preview({ entry, texts }: { entry: PackEntry; texts: PackText[] }) {
  const text = (p: string) => texts.find((t) => t.path === p)?.text ?? null;
  if (entry.kind === "bundle") return null;
  if (entry.kind === "collection" && entry.collection) {
    const schema = text(`schemas/${entry.collection}.yaml`);
    const index = text("index.md");
    const props = schema ? listOf(schema, "properties") : [];
    const views = index ? listOf(splitFrontmatter(index).fm, "views") : [];
    const rowTpl = text(`templates/${entry.collection}.md`);
    if (!props.length && !views.length) return null;
    return (
      <div className={styles.preview}>
        <div className={styles.previewHead}>
          <span><DatabaseIcon size={12} /> collections/{entry.collection}/</span>
          {views.length > 0 && <span className={styles.views}>{views.map((v) => <span key={v.name} className={styles.view}>{v.name}</span>)}</span>}
        </div>
        <table className={styles.columns}>
          <thead><tr><th>title</th>{props.map((p) => <th key={p.name}>{p.name}</th>)}</tr></thead>
          <tbody>
            <tr>
              <td className={styles.colType}>text</td>
              {props.map((p) => <td key={p.name} className={styles.colType}>{p.type}{p.options.length > 0 ? ` · ${p.options.join(" / ")}` : ""}</td>)}
            </tr>
          </tbody>
        </table>
        {rowTpl && <Excerpt text={splitFrontmatter(rowTpl).body} label={`templates/${entry.collection}.md — the shape of a new row`} />}
      </div>
    );
  }
  const first = entry.files.find((f) => f.startsWith("templates/"));
  const body = first ? text(first) : null;
  if (!body) return null;
  return (
    <div className={styles.preview}>
      <Excerpt text={splitFrontmatter(body).body} label={first!} />
    </div>
  );
}

function Excerpt({ text, label }: { text: string; label: string }) {
  const lines = text.replace(/\s+$/, "").split("\n");
  const shown = lines.slice(0, 28);
  return (
    <div className={styles.excerpt}>
      <div className={styles.excerptLabel}><TemplateIcon size={11} /> {label}</div>
      <pre className={styles.excerptBody}>{shown.join("\n")}{lines.length > shown.length ? `\n… ${lines.length - shown.length} more lines` : ""}</pre>
    </div>
  );
}
