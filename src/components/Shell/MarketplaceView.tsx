// Marketplace — a full-window page in the Settings shell: nav left, content
// right. Cards for every pack the vault can see (bundled official ones plus
// the configured indexes), a pack page that shows what an install gives you
// (screenshots, properties, views, the template as it reads) with the exact
// files behind a Details fold, and Install / Update / Remove that never
// overwrite the user's own work. Nothing here fetches or installs on its own; every write is a click,
// and `.cortex/packs.yaml` records it so `cortex packs` sees the same state.

import { useCallback, useEffect, useMemo, useRef, useState, ReactNode, KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { openExternal } from "../../lib/links";
import { tagStyle } from "../../lib/colors";
import {
  commands, PackCatalog, PackEntry, Pack, PackPlan, PackPreview, PackPreviewProperty, PackKind, PackTier,
  PackInstallReport, PackUpdateReport, PackRemoveReport,
} from "../../lib/commands";
import { Dropdown } from "./Dropdown";
import { MiniMarkdown, renderInline } from "./MiniMarkdown";
import {
  CloseIcon, SearchIcon, SyncIcon, TemplateIcon, DatabaseIcon, SparkleIcon, ChevronLeftIcon, ChevronRightIcon,
  OpenIcon, TagsListIcon, CheckSquareIcon, FolderIcon, TextLinesIcon,
  TableIcon, BoardIcon, CalendarIcon, GalleryIcon, ListIcon, ChartIcon, TrackerIcon, TimelineIcon,
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

const KIND_LABEL: Record<PackKind, string> = { note: "Note templates", collection: "Collections", bundle: "Bundles" };
const KIND_ONE: Record<PackKind, string> = { note: "Note template", collection: "Collection", bundle: "Bundle" };
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
              blurb={filter === "all" && !q ? "Note templates and collections, as Markdown and YAML — readable in any editor, never code." : undefined}
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

/** The bundled packs and the official index; anything else is an index the
 *  user added in Settings, whose images are not loaded and whose packs say so. */
function isOfficialSource(source: string): boolean {
  return source === "bundled" || source.startsWith("https://frontal-cortex.github.io/marketplace/");
}

function SourceBadge() {
  return (
    <span className={`${styles.tier} ${styles.tier_community}`}
      title="From an index you added in Settings. Its hash check proves the files match that index, not that the index is honest — read the seeds and body before installing.">
      Third-party index
    </span>
  );
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
  // preview.png, or the first gallery screenshot when the pack ships none.
  const hero = entry.preview ?? entry.previews[0] ?? null;
  return (
    <div
      className={`${styles.card} ${entry.needs_newer_app ? styles.cardDim : ""}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
    >
      {hero && isOfficialSource(entry.source) ? (
        <img className={styles.cardImage} src={hero} alt="" loading="lazy" />
      ) : entry.excerpt ? (
        <CardExcerpt entry={entry} />
      ) : (
        <div className={`${styles.cardImage} ${styles.cardGlyph}`}><KindIcon kind={entry.kind} size={22} /></div>
      )}
      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <span className={styles.cardName}>{entry.name}</span>
          <TierBadge tier={entry.tier} />
          {!isOfficialSource(entry.source) && <SourceBadge />}
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

/** The card's picture when a pack ships none: a miniature of what installing
 *  it gives you — drawn from the pack's own schema, views, seeds and template
 *  in the app's tokens, so it is true to the pack and to the theme. */
function CardExcerpt({ entry }: { entry: PackEntry }) {
  const ex = entry.excerpt!;
  const primary = ex.views[0]?.[1] ?? (entry.kind === "collection" ? "table" : "note");
  const tone = (c: string) => ({ background: `var(--tag-${c}-bg)`, color: `var(--tag-${c}-fg)` } as React.CSSProperties);
  const firstSelect = ex.options[0];
  const titles = ex.seeds.length ? ex.seeds : ["Untitled", "Untitled", "Untitled"];
  const cell = (row: number, [name, type]: [string, string]) => {
    const opts = ex.options.find(([p]) => p === name)?.[1];
    if (opts && opts.length) { const o = opts[row % opts.length]; return <span key={name} className={styles.heroPill} style={tone(o[1])}>{o[0]}</span>; }
    if (type === "checkbox") return <span key={name} className={`${styles.heroCheck} ${row % 2 === 0 ? styles.heroCheckOn : ""}`} />;
    if (type === "date") return <span key={name} className={styles.heroDate}>{["Mon", "Wed", "Fri"][row % 3]}</span>;
    if (type === "number") return <span key={name} className={styles.heroNum}>{[12, 7, 30][row % 3]}</span>;
    return <span key={name} className={styles.heroBar} style={{ width: `${40 + ((row * 37 + name.length * 11) % 45)}%` }} />;
  };

  let body: React.ReactNode;
  if (entry.kind === "note" || primary === "note") {
    body = (
      <div className={styles.heroPage}>
        <div className={styles.heroPageTitle}>{ex.icon ? `${ex.icon} ` : ""}{entry.name}</div>
        {ex.headings.slice(0, 3).map((h, i) => (
          <div key={i} className={styles.heroSection}>
            <div className={styles.heroHeading}>{h}</div>
            <span className={styles.heroText} style={{ width: `${70 - i * 15}%` }} />
          </div>
        ))}
        {ex.headings.length === 0 && <><span className={styles.heroText} style={{ width: "80%" }} /><span className={styles.heroText} style={{ width: "60%" }} /></>}
      </div>
    );
  } else if (primary === "board" && firstSelect) {
    const cols = firstSelect[1].slice(0, 3);
    body = (
      <div className={styles.heroBoard}>
        {cols.map(([name, color], i) => (
          <div key={name} className={styles.heroCol}>
            <span className={styles.heroPill} style={tone(color)}>{name}</span>
            {titles.slice(0, i === 0 ? 2 : 1).map((t, j) => <div key={j} className={styles.heroCard}>{t}</div>)}
          </div>
        ))}
      </div>
    );
  } else if (primary === "calendar") {
    body = (
      <div className={styles.heroCal}>
        {Array.from({ length: 28 }, (_, i) => (
          <span key={i} className={`${styles.heroDay} ${[3, 9, 10, 17, 22].includes(i) ? styles.heroDayOn : ""} ${i === 9 ? styles.heroDayToday : ""}`} />
        ))}
      </div>
    );
  } else if (primary === "tracker") {
    body = (
      <div className={styles.heroTrack}>
        {titles.slice(0, 3).map((t, r) => (
          <div key={r} className={styles.heroTrackRow}>
            <span className={styles.heroTrackName}>{t}</span>
            {Array.from({ length: 7 }, (_, d) => (
              <span key={d} className={`${styles.heroMark} ${(d + r) % 3 !== 1 && d < 5 ? styles.heroMarkOn : ""}`} />
            ))}
          </div>
        ))}
      </div>
    );
  } else if (primary === "chart") {
    body = (
      <div className={styles.heroChart}>
        {[35, 50, 42, 68, 60, 82, 74].map((h, i) => <span key={i} className={styles.heroBarV} style={{ height: `${h}%` }} />)}
      </div>
    );
  } else if (primary === "gallery") {
    body = (
      <div className={styles.heroGallery}>
        {titles.slice(0, 3).map((t, i) => <div key={i} className={styles.heroGalleryCard}><span className={styles.heroCover} /><span className={styles.heroCaption}>{t}</span></div>)}
      </div>
    );
  } else {
    const props = ex.properties.filter(([n]) => n !== "title").slice(0, 3) as [string, string][];
    body = (
      <div className={styles.heroTable}>
        <div className={`${styles.heroRow} ${styles.heroHead}`}>
          <span>title</span>{props.map(([n]) => <span key={n}>{n}</span>)}
        </div>
        {titles.slice(0, 3).map((t, r) => (
          <div key={r} className={styles.heroRow}>
            <span className={styles.heroTitleCell}>{t}</span>
            {props.map((p) => cell(r, p))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={`${styles.cardImage} ${styles.hero}`} aria-hidden>
      {body}
      {ex.views.length > 1 && (
        <div className={styles.heroViews}>{ex.views.slice(0, 4).map(([name]) => <span key={name}>{name}</span>)}</div>
      )}
      <div className={styles.heroFade} />
    </div>
  );
}

// ── Pack page ─────────────────────────────────────────────────────────────────
//
// Pictures before prose: the gallery (when the index supplies screenshots),
// a two-sentence lead, a row of chips saying what an install gives you, the
// properties with their options as coloured pills, the template rendered the
// way a note reads — and the file list, licence and source folded away at
// the bottom, where someone who wants the exact paths still finds them.

type Report =
  | { kind: "install"; reports: PackInstallReport[] }
  | { kind: "update"; report: PackUpdateReport }
  | { kind: "remove"; report: PackRemoveReport };

function PackPage({ entry, onBack, onChanged }: { entry: PackEntry; onBack: () => void; onChanged: () => void }) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [plan, setPlan] = useState<PackPlan | null>(null);
  // undefined while loading; null when the pack could not be read.
  const [preview, setPreview] = useState<PackPreview | null | undefined>(undefined);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<null | "install" | "update" | "remove">(null);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const load = useCallback(() => {
    commands.packsShow(entry.id, force).then(([p, pl]) => { setPack(p); setPlan(pl); setErr(null); }).catch((e) => setErr(String(e)));
  }, [entry.id, force]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let live = true;
    commands.packsPreview(entry.id).then((pv) => { if (live) setPreview(pv); }).catch(() => { if (live) setPreview(null); });
    return () => { live = false; };
  }, [entry.id]);

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
  const official = isOfficialSource(entry.source);
  const sourceUrl = official ? `${MARKETPLACE_REPO}/tree/main/packs/${entry.id}` : entry.source;
  // Screenshots load only from the official index (see the trust model);
  // the hero comes first, the gallery after it, without repeating the hero.
  const images = official ? [entry.preview, ...entry.previews].filter((u, i, all): u is string => !!u && all.indexOf(u) === i) : [];
  const hasPreview = !!preview && (preview.collections.length > 0 || preview.templates.length > 0 || preview.includes.length > 0);
  const many = (preview?.collections.length ?? 0) > 1;

  return (
    <section className={styles.section} aria-label={entry.name}>
      <button className={styles.back} onClick={onBack}><ChevronLeftIcon size={13} /> All templates</button>
      <div className={styles.packHead}>
        <span className={styles.packGlyph}><KindIcon kind={entry.kind} size={20} /></span>
        <div className={styles.packTitle}>
          <h2 className={styles.sectionTitle}>{entry.name} <TierBadge tier={entry.tier} />{!official && <> <SourceBadge /></>}</h2>
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

      <Gallery images={images} name={entry.name} />

      <Lead text={(m?.description || entry.description || entry.summary).trim()} tags={entry.tags} />

      {preview && hasPreview && <Glance preview={preview} />}

      {preview?.collections.map((c) => (
        <div key={c.name} className={styles.block}>
          {many && (
            <h3 className={styles.h3}>
              {c.icon && <span className={styles.blockIcon}>{c.icon}</span>}{c.title || c.name}
              <code className={styles.blockPath}>collections/{c.name}/</code>
            </h3>
          )}
          {!many && <h3 className={styles.h3}>Properties</h3>}
          <PropertyList properties={c.properties} />
          {c.template && <TemplateBlock label={`New row in ${c.title || c.name}`} path={`collections/${c.name}/_template-${c.name}.md`} body={c.template} />}
        </div>
      ))}

      {preview && preview.templates.length > 0 && (
        <div className={styles.block}>
          <h3 className={styles.h3}>{preview.templates.length === 1 ? "Note template" : "Note templates"}</h3>
          {preview.templates.map((t) => (
            <TemplateBlock key={t.path} label={t.title ?? t.path.replace(/^templates\//, "").replace(/\.md$/, "")} path={t.path} body={t.body} open={preview.collections.length === 0 && preview.templates.length === 1} />
          ))}
        </div>
      )}

      {preview !== undefined && (
        <details className={styles.details} open={images.length === 0 && !hasPreview}>
          <summary className={styles.summary}>
            <ChevronRightIcon size={12} /> Details
            <span className={styles.summaryHint}>{plan ? `${plan.steps.length} files` : "files"} · {entry.license || "no licence"} · source</span>
          </summary>
          <div className={styles.detailsBody}>
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
          </div>
        </details>
      )}
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

// ── Gallery: the screenshots, with a lightbox ────────────────────────────────

function Gallery({ images, name }: { images: string[]; name: string }) {
  const [i, setI] = useState(0);
  const [big, setBig] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const n = images.length;
  const go = useCallback((d: number) => { if (n > 1) setI((x) => (x + d + n) % n); }, [n]);
  useEffect(() => { setI(0); }, [images.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    stripRef.current?.children[i]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [i]);
  if (n === 0) return null;
  const cur = Math.min(i, n - 1);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    else if (e.key === "Enter") { e.preventDefault(); setBig(true); }
  };
  return (
    <div className={styles.gallery} tabIndex={0} onKeyDown={onKey} role="group" aria-label={`${name} screenshots`}>
      <div className={styles.galleryMain}>
        <img
          className={styles.galleryImage}
          src={images[cur]}
          alt={`${name} screenshot ${cur + 1} of ${n}`}
          onClick={() => setBig(true)}
          title="Click to enlarge"
        />
        {n > 1 && (
          <>
            <button className={`${styles.galleryArrow} ${styles.galleryPrev}`} onClick={() => go(-1)} aria-label="Previous screenshot" tabIndex={-1}><ChevronLeftIcon size={16} /></button>
            <button className={`${styles.galleryArrow} ${styles.galleryNext}`} onClick={() => go(1)} aria-label="Next screenshot" tabIndex={-1}><ChevronRightIcon size={16} /></button>
            <span className={styles.galleryCount}>{cur + 1} / {n}</span>
          </>
        )}
      </div>
      {n > 1 && (
        <div className={styles.thumbs} ref={stripRef}>
          {images.map((src, j) => (
            <button key={src} className={`${styles.thumb} ${j === cur ? styles.thumbOn : ""}`} onClick={() => setI(j)} aria-label={`Screenshot ${j + 1}`} tabIndex={-1}>
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {big && <Lightbox src={images[cur]} index={cur} count={n} onClose={() => setBig(false)} onStep={go} />}
    </div>
  );
}

function Lightbox({ src, index, count, onClose, onStep }: { src: string; index: number; count: number; onClose: () => void; onStep: (d: number) => void }) {
  useEffect(() => {
    // Capture phase, so the marketplace's own Escape handler (which backs out
    // of the pack page) does not see the key that closed the lightbox.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); onStep(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); onStep(-1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onStep]);
  return createPortal(
    <div className={styles.lightbox} onClick={onClose} role="dialog" aria-label="Screenshot">
      <img className={styles.lightboxImage} src={src} alt="" onClick={(e) => e.stopPropagation()} />
      {count > 1 && (
        <>
          <button className={`${styles.galleryArrow} ${styles.galleryPrev}`} onClick={(e) => { e.stopPropagation(); onStep(-1); }} aria-label="Previous screenshot"><ChevronLeftIcon size={18} /></button>
          <button className={`${styles.galleryArrow} ${styles.galleryNext}`} onClick={(e) => { e.stopPropagation(); onStep(1); }} aria-label="Next screenshot"><ChevronRightIcon size={18} /></button>
          <span className={`${styles.galleryCount} ${styles.lightboxCount}`}>{index + 1} / {count}</span>
        </>
      )}
      <button className={styles.lightboxClose} onClick={onClose} aria-label="Close (Esc)"><CloseIcon size={16} /></button>
    </div>,
    document.body,
  );
}

// ── Lead: the first sentence or two, the rest behind More ───────────────────

/** The first sentence, plus the second when together they stay short. */
function splitLead(text: string): { lead: string; rest: string } {
  const t = text.trim();
  const paras = t.split(/\n\s*\n/);
  const first = paras[0].replace(/\s+/g, " ").trim();
  const sentences = first.split(/(?<=[.!?])\s+(?=[A-Z0-9("`*])/);
  let lead = sentences[0] ?? first;
  if (sentences.length > 1 && (lead + " " + sentences[1]).length <= 240) lead = `${lead} ${sentences[1]}`;
  const restFirst = first.slice(lead.length).trim();
  const rest = [restFirst, ...paras.slice(1)].filter((p) => p.trim()).join("\n\n");
  return { lead, rest };
}

function Lead({ text, tags }: { text: string; tags: string[] }) {
  const [more, setMore] = useState(false);
  const { lead, rest } = useMemo(() => splitLead(text), [text]);
  return (
    <div className={styles.lead}>
      <p className={styles.leadText}>
        {renderInline(lead, "lead")}
        {rest && !more && <> <button className={styles.more} onClick={() => setMore(true)}>More</button></>}
      </p>
      {more && rest && (
        <div className={styles.leadRest}>
          <MiniMarkdown body={rest} />
          <button className={styles.more} onClick={() => setMore(false)}>Less</button>
        </div>
      )}
      {tags.length > 0 && <div className={styles.cardTags}>{tags.map((t) => <span key={t} className={styles.tag}>{t}</span>)}</div>}
    </div>
  );
}

// ── At a glance: chips for what an install gives you ────────────────────────

/** The same icons the view switcher uses, keyed by the view's type. */
function viewTypeIcon(type: string, size = 12) {
  switch (type) {
    case "board": return <BoardIcon size={size} />;
    case "calendar": return <CalendarIcon size={size} />;
    case "gallery": return <GalleryIcon size={size} />;
    case "list": return <ListIcon size={size} />;
    case "chart": return <ChartIcon size={size} />;
    case "tracker": return <TrackerIcon size={size} />;
    case "timeline": return <TimelineIcon size={size} />;
    default: return <TableIcon size={size} />;
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function Glance({ preview }: { preview: PackPreview }) {
  const props = preview.collections.reduce((n, c) => n + c.properties.length, 0);
  const seeds = preview.collections.reduce((n, c) => n + c.seeds, 0);
  const views = preview.collections.flatMap((c) => c.views.map((v) => ({ ...v, coll: c.title || c.name })));
  const manyColls = preview.collections.length > 1;
  return (
    <div className={styles.glance} aria-label="At a glance">
      {manyColls && <span className={styles.chip}><DatabaseIcon size={12} /> {plural(preview.collections.length, "collection")}</span>}
      {props > 0 && <span className={styles.chip}><TextLinesIcon size={12} /> {plural(props, "property", "properties")}</span>}
      {views.map((v, i) => (
        <span key={`${v.coll}-${v.name}-${i}`} className={`${styles.chip} ${styles.chipView}`} title={`${v.type} view${manyColls ? ` in ${v.coll}` : ""}`}>
          {viewTypeIcon(v.type)} {v.name}
        </span>
      ))}
      {seeds > 0 && <span className={styles.chip}><DatabaseIcon size={12} /> {plural(seeds, "example row")}</span>}
      {preview.templates.length > 0 && <span className={styles.chip}><TemplateIcon size={12} /> {plural(preview.templates.length, "note template")}</span>}
      {preview.includes.map((id) => <span key={id} className={styles.chip}><FolderIcon size={12} /> {id}</span>)}
    </div>
  );
}

// ── Properties: one row each, options as the pills they become ──────────────

const TYPE_LABEL: Record<string, string> = {
  multi_select: "multi-select", date_range: "date range", created_time: "created", created_by: "created by",
  edited_time: "edited", edited_by: "edited by",
};

function PropertyList({ properties }: { properties: PackPreviewProperty[] }) {
  const row = (name: string, type: string, extra: ReactNode, key: string) => (
    <div key={key} className={styles.propRow}>
      <span className={styles.propName}>{name}</span>
      <span className={styles.typeChip}>{TYPE_LABEL[type] ?? type}</span>
      <span className={styles.propExtra}>{extra}</span>
    </div>
  );
  return (
    <div className={styles.props}>
      {row("title", "text", <span className={styles.propHint}>the row's name</span>, "_title")}
      {properties.map((p) => row(p.name, p.type, (
        <>
          {p.options.length > 0 && p.options.map((o) => <span key={o.name} className={styles.pill} style={tagStyle(o.color)}>{o.name}</span>)}
          {p.detail && <span className={styles.propHint}>{p.detail}</span>}
          {p.format && <span className={styles.propHint}>{p.format}</span>}
        </>
      ), p.name))}
    </div>
  );
}

// ── Template: rendered like a note, raw on request ──────────────────────────

function TemplateBlock({ label, path, body, open: initiallyOpen = false }: { label: string; path: string; body: string; open?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [raw, setRaw] = useState(false);
  return (
    <div className={styles.tpl}>
      <div className={styles.tplBar}>
        <button className={styles.tplToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={`${styles.tplChevron} ${open ? styles.tplChevronOpen : ""}`}><ChevronRightIcon size={12} /></span>
          {open ? "Hide template" : "Show template"}
          <span className={styles.tplLabel}>{renderInline(label, "tpl")}</span>
        </button>
        {open && (
          <button className={`${styles.tplRaw} ${raw ? styles.tplRawOn : ""}`} onClick={() => setRaw((r) => !r)} aria-pressed={raw} title={raw ? "Show it rendered" : `Show the source of ${path}`}>
            Raw
          </button>
        )}
      </div>
      {open && (raw
        ? <pre className={styles.tplSource}>{body}</pre>
        : <div className={styles.tplBody}><MiniMarkdown body={body} /></div>
      )}
      {open && <code className={styles.tplPath}>{path}</code>}
    </div>
  );
}
